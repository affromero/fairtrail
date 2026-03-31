import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { cached } from '@/lib/redis';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const query = await prisma.query.findUnique({
    where: { id },
    select: {
      id: true,
      origin: true,
      originName: true,
      destination: true,
      destinationName: true,
      dateFrom: true,
      dateTo: true,
      flexibility: true,
      maxPrice: true,
      maxStops: true,
      preferredAirlines: true,
      timePreference: true,
      cabinClass: true,
      tripType: true,
      currency: true,
      expiresAt: true,
      createdAt: true,
      active: true,
    },
  });

  if (!query) {
    return apiError('Query not found', 404);
  }

  if (new Date() > query.expiresAt) {
    return apiError('This tracker has expired', 410);
  }

  const snapshots = await cached(
    `ft:prices:${id}`,
    () =>
      prisma.priceSnapshot.findMany({
        where: { queryId: id },
        orderBy: { scrapedAt: 'asc' },
        select: {
          id: true,
          travelDate: true,
          price: true,
          currency: true,
          airline: true,
          bookingUrl: true,
          stops: true,
          duration: true,
          flightId: true,
          departureTime: true,
          arrivalTime: true,
          seatsLeft: true,
          status: true,
          airlineDirectPrice: true,
          vpnCountry: true,
          scrapedAt: true,
        },
      }),
    120 // 2 min cache for public page
  );

  const lastRun = await prisma.fetchRun.findFirst({
    where: { queryId: id },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, status: true },
  });

  return apiSuccess({
    query,
    snapshots,
    lastChecked: lastRun?.startedAt ?? null,
    lastStatus: lastRun?.status ?? null,
    snapshotCount: snapshots.length,
  });
}
