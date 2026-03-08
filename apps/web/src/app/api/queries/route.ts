import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { hasValidInvite } from '@/lib/invite-auth';

interface RouteInput {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  selectedFlights: Array<{
    travelDate: string;
    price: number;
    currency?: string;
    airline: string;
    bookingUrl: string;
    stops?: number;
    duration?: string | null;
  }>;
}

export async function POST(request: NextRequest) {
  if (!(await hasValidInvite())) {
    return apiError('Invite code required', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const {
    rawInput,
    dateFrom,
    dateTo,
    flexibility,
    maxPrice,
    maxStops,
    preferredAirlines,
    timePreference,
    cabinClass,
    tripType,
  } = body;

  // Support both new (routes array) and legacy (single origin/destination) formats
  let routeInputs: RouteInput[];

  if (Array.isArray(body.routes) && body.routes.length > 0) {
    routeInputs = body.routes;
  } else if (body.origin && body.destination) {
    // Legacy single-route format
    routeInputs = [{
      origin: body.origin,
      originName: body.originName || body.origin,
      destination: body.destination,
      destinationName: body.destinationName || body.destination,
      selectedFlights: Array.isArray(body.selectedFlights) ? body.selectedFlights : [],
    }];
  } else {
    return apiError('Missing required fields: routes array or origin/destination', 400);
  }

  if (!rawInput || !dateFrom || !dateTo) {
    return apiError('Missing required fields: rawInput, dateFrom, dateTo', 400);
  }

  // Validate all route airport codes
  for (const route of routeInputs) {
    if (!/^[A-Z]{3}$/.test(route.origin) || !/^[A-Z]{3}$/.test(route.destination)) {
      return apiError(`Invalid airport code in route ${route.origin}→${route.destination}`, 400);
    }
  }

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T00:00:00Z');

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('Invalid date format', 400);
  }

  const isOneWay = tripType === 'one_way';
  if (!isOneWay && from >= to) {
    return apiError('dateFrom must be before dateTo', 400);
  }

  const flex = Math.max(0, Math.min(Number(flexibility) || 0, 14));
  const expiresAt = new Date(to);
  expiresAt.setDate(expiresAt.getDate() + flex);

  const airlines: string[] = Array.isArray(preferredAirlines) ? preferredAirlines : [];
  const groupId = crypto.randomUUID();

  const results: Array<{
    id: string;
    origin: string;
    originName: string;
    destination: string;
    destinationName: string;
    deleteToken: string;
  }> = [];

  for (const route of routeInputs) {
    const flights = route.selectedFlights || [];

    // Derive airlines from selected flights if not explicitly set
    let routeAirlines = airlines;
    if (routeAirlines.length === 0 && flights.length > 0) {
      routeAirlines = [...new Set(flights.map((f) => f.airline))];
    }

    const deleteToken = crypto.randomUUID();

    const query = await prisma.query.create({
      data: {
        rawInput,
        origin: route.origin,
        originName: route.originName,
        destination: route.destination,
        destinationName: route.destinationName,
        dateFrom: from,
        dateTo: to,
        flexibility: flex,
        maxPrice: maxPrice ? Number(maxPrice) : null,
        maxStops: maxStops !== undefined && maxStops !== null ? Number(maxStops) : null,
        preferredAirlines: routeAirlines,
        timePreference: timePreference || 'any',
        cabinClass: cabinClass || 'economy',
        tripType: tripType === 'one_way' ? 'one_way' : 'round_trip',
        expiresAt,
        deleteToken,
        groupId,
      },
    });

    if (flights.length > 0) {
      await prisma.priceSnapshot.createMany({
        data: flights.map((f) => ({
          queryId: query.id,
          travelDate: new Date(f.travelDate),
          price: f.price,
          currency: f.currency || 'USD',
          airline: f.airline,
          bookingUrl: f.bookingUrl,
          stops: f.stops ?? 0,
          duration: f.duration ?? null,
        })),
      });
    }

    results.push({
      id: query.id,
      origin: route.origin,
      originName: route.originName,
      destination: route.destination,
      destinationName: route.destinationName,
      deleteToken,
    });
  }

  return apiSuccess({ queries: results }, 201);
}
