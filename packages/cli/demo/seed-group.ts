import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

const existing = await prisma.query.findFirst({ orderBy: { createdAt: 'desc' } });
if (!existing) { console.error('No query found'); process.exit(1); }
const groupId = existing.groupId;

const routes = [
  { origin: 'FRA', originName: 'Frankfurt', dest: 'MDE', destName: 'Medellín', dateFrom: '2026-12-05' },
  { origin: 'FRA', originName: 'Frankfurt', dest: 'CTG', destName: 'Cartagena', dateFrom: '2026-12-10' },
];

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

for (const r of routes) {
  const q = await prisma.query.create({
    data: {
      rawInput: 'Frankfurt to Colombia December 2026',
      origin: r.origin, originName: r.originName,
      destination: r.dest, destinationName: r.destName,
      dateFrom: new Date(r.dateFrom + 'T00:00:00Z'),
      dateTo: new Date(r.dateFrom + 'T00:00:00Z'),
      flexibility: 3, currency: 'USD', cabinClass: 'economy',
      tripType: 'round_trip', timePreference: 'any',
      preferredAirlines: [], maxPrice: null, maxStops: null,
      expiresAt: new Date('2027-01-01'), deleteToken: randomUUID(), groupId,
    }
  });

  const airlines = [
    { name: 'Avianca', base: r.dest === 'MDE' ? 490 : 520 },
    { name: 'LATAM', base: r.dest === 'MDE' ? 540 : 580 },
    { name: 'Air France', base: r.dest === 'MDE' ? 610 : 650 },
  ];

  const snaps = [];
  for (let day = 5; day >= 0; day--) {
    for (const a of airlines) {
      const drift = a.name === 'Avianca' ? -8 * (5 - day) : a.name === 'LATAM' ? 10 * (5 - day) : Math.sin(day) * 25;
      snaps.push({
        queryId: q.id, travelDate: new Date(r.dateFrom + 'T00:00:00Z'),
        price: Math.round(a.base + drift + (Math.random() - 0.5) * 20),
        currency: 'USD', airline: a.name, bookingUrl: 'https://google.com/travel/flights',
        stops: 1, duration: '14h 30m', scrapedAt: new Date(now - day * DAY), status: 'available',
      });
    }
  }
  await prisma.priceSnapshot.createMany({ data: snaps });
  console.log('Created', r.dest, '→', q.id, 'with', snaps.length, 'snapshots');
}

process.exit(0);
