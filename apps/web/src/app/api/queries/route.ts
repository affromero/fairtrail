import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { hasValidInvite } from '@/lib/invite-auth';

export async function POST(request: NextRequest) {
  if (!(await hasValidInvite())) {
    return apiError('Invite code required', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const {
    rawInput,
    origin,
    originName,
    destination,
    destinationName,
    dateFrom,
    dateTo,
    flexibility,
    maxPrice,
    maxStops,
    preferredAirlines,
    timePreference,
    cabinClass,
    selectedFlights,
  } = body;

  if (!rawInput || !origin || !destination || !dateFrom || !dateTo) {
    return apiError('Missing required fields', 400);
  }

  // Validate IATA codes (3 uppercase letters)
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    return apiError('Invalid airport code — must be 3 uppercase letters', 400);
  }

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T00:00:00Z');

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('Invalid date format', 400);
  }

  if (from >= to) {
    return apiError('dateFrom must be before dateTo', 400);
  }

  const flex = Math.max(0, Math.min(Number(flexibility) || 0, 14));

  // Expiry = last travel date + flexibility
  const expiresAt = new Date(to);
  expiresAt.setDate(expiresAt.getDate() + flex);

  // Derive preferredAirlines from selected flights if not explicitly set
  const flights = Array.isArray(selectedFlights) ? selectedFlights : [];
  let airlines: string[] = Array.isArray(preferredAirlines) ? preferredAirlines : [];
  if (airlines.length === 0 && flights.length > 0) {
    airlines = [...new Set(flights.map((f: { airline: string }) => f.airline))];
  }

  const query = await prisma.query.create({
    data: {
      rawInput,
      origin,
      originName: originName || origin,
      destination,
      destinationName: destinationName || destination,
      dateFrom: from,
      dateTo: to,
      flexibility: flex,
      maxPrice: maxPrice ? Number(maxPrice) : null,
      maxStops: maxStops !== undefined && maxStops !== null ? Number(maxStops) : null,
      preferredAirlines: airlines,
      timePreference: timePreference || 'any',
      cabinClass: cabinClass || 'economy',
      expiresAt,
    },
  });

  // Store selected flights as initial price snapshots
  if (flights.length > 0) {
    await prisma.priceSnapshot.createMany({
      data: flights.map((f: { travelDate: string; price: number; currency?: string; airline: string; bookingUrl: string; stops?: number; duration?: string | null }) => ({
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

  return apiSuccess({ id: query.id }, 201);
}
