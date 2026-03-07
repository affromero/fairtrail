import { prisma } from '@/lib/prisma';

export interface AirlineRouteStats {
  airline: string;
  route: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  stability: number; // coefficient of variation (0 = stable, 1+ = volatile)
  snapshotCount: number;
  competitiveRank: number;
  trend: 'rising' | 'falling' | 'stable';
}

export interface RouteOverview {
  route: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  airlines: AirlineRouteStats[];
  cheapestAirline: string;
  mostStableAirline: string;
  totalSnapshots: number;
}

export interface InsightsSummary {
  totalSeedRoutes: number;
  totalSnapshots: number;
  totalAirlines: number;
  routes: RouteOverview[];
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function computeTrend(values: { price: number; time: number }[]): 'rising' | 'falling' | 'stable' {
  if (values.length < 3) return 'stable';

  // Simple linear regression slope
  const n = values.length;
  const sumX = values.reduce((s, v) => s + v.time, 0);
  const sumY = values.reduce((s, v) => s + v.price, 0);
  const sumXY = values.reduce((s, v) => s + v.time * v.price, 0);
  const sumX2 = values.reduce((s, v) => s + v.time * v.time, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 'stable';

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanPrice = sumY / n;

  // Normalize slope relative to mean price
  const normalizedSlope = slope / meanPrice;

  // Threshold: ±2% per unit time = meaningful trend
  if (normalizedSlope > 0.02) return 'rising';
  if (normalizedSlope < -0.02) return 'falling';
  return 'stable';
}

export async function computeInsights(days = 30): Promise<InsightsSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const seedQueries = await prisma.query.findMany({
    where: { isSeed: true },
    select: { id: true, origin: true, originName: true, destination: true, destinationName: true },
  });

  if (seedQueries.length === 0) {
    return { totalSeedRoutes: 0, totalSnapshots: 0, totalAirlines: 0, routes: [] };
  }

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      queryId: { in: seedQueries.map((q) => q.id) },
      scrapedAt: { gte: since },
    },
    select: { queryId: true, airline: true, price: true, scrapedAt: true },
    orderBy: { scrapedAt: 'asc' },
  });

  // Group snapshots by route (queryId) and airline
  const byRouteAirline = new Map<string, Map<string, { prices: number[]; timed: { price: number; time: number }[] }>>();

  for (const snap of snapshots) {
    let routeMap = byRouteAirline.get(snap.queryId);
    if (!routeMap) {
      routeMap = new Map();
      byRouteAirline.set(snap.queryId, routeMap);
    }
    let airlineData = routeMap.get(snap.airline);
    if (!airlineData) {
      airlineData = { prices: [], timed: [] };
      routeMap.set(snap.airline, airlineData);
    }
    airlineData.prices.push(snap.price);
    airlineData.timed.push({ price: snap.price, time: snap.scrapedAt.getTime() });
  }

  const allAirlines = new Set<string>();
  const routes: RouteOverview[] = [];

  for (const query of seedQueries) {
    const routeMap = byRouteAirline.get(query.id);
    if (!routeMap || routeMap.size === 0) {
      routes.push({
        route: `${query.origin}-${query.destination}`,
        origin: query.origin,
        originName: query.originName,
        destination: query.destination,
        destinationName: query.destinationName,
        airlines: [],
        cheapestAirline: '-',
        mostStableAirline: '-',
        totalSnapshots: 0,
      });
      continue;
    }

    const airlineStats: AirlineRouteStats[] = [];

    for (const [airline, data] of routeMap) {
      allAirlines.add(airline);
      const avg = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
      airlineStats.push({
        airline,
        route: `${query.origin}-${query.destination}`,
        avgPrice: Math.round(avg * 100) / 100,
        minPrice: Math.min(...data.prices),
        maxPrice: Math.max(...data.prices),
        stability: Math.round(coefficientOfVariation(data.prices) * 1000) / 1000,
        snapshotCount: data.prices.length,
        competitiveRank: 0, // computed below
        trend: computeTrend(data.timed),
      });
    }

    // Compute competitive rank (1 = cheapest avg price)
    airlineStats.sort((a, b) => a.avgPrice - b.avgPrice);
    airlineStats.forEach((s, i) => { s.competitiveRank = i + 1; });

    const cheapest = airlineStats[0];
    const mostStable = [...airlineStats].sort((a, b) => a.stability - b.stability)[0];
    const totalSnaps = airlineStats.reduce((s, a) => s + a.snapshotCount, 0);

    routes.push({
      route: `${query.origin}-${query.destination}`,
      origin: query.origin,
      originName: query.originName,
      destination: query.destination,
      destinationName: query.destinationName,
      airlines: airlineStats,
      cheapestAirline: cheapest?.airline ?? '-',
      mostStableAirline: mostStable?.airline ?? '-',
      totalSnapshots: totalSnaps,
    });
  }

  return {
    totalSeedRoutes: seedQueries.length,
    totalSnapshots: snapshots.length,
    totalAirlines: allAirlines.size,
    routes,
  };
}
