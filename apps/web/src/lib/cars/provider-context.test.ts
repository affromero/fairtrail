import { describe, expect, it } from 'vitest';
import { validateCarSearch } from './validation';
import { verifyCarProviderContext } from './provider-context';

const search = validateCarSearch({
  pickup: { name: 'Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712', autoeurope: '547' } },
  dropoff: { name: 'Gatwick', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1600', autoeurope: '548' } },
  pickupAt: { date: '2026-10-15', time: '11:30' }, dropoffAt: { date: '2026-10-18', time: '12:00' },
  driver: { age: 23, licenceYears: 2, residenceCountry: 'US' }, currency: 'USD', sources: ['discovercars', 'autoeurope'],
}, new Date('2026-09-01'));
const discover = { PickupLocationId: 1712, DropOffLocationId: 1600, PickupDateTime: '2026-10-15T11:30:00', DropOffDateTime: '2026-10-18T12:00:00', DriverAge: 23, ResidenceCountry: 'US' };
const discoverUrl = (value: unknown) => `https://www.discovercars.com/offer/session?sq=${encodeURIComponent(Buffer.from(JSON.stringify(value)).toString('base64'))}`;
const auto = () => new URL('https://book.autoeurope.com/en-us/options?pickup_location=547&dropoff_location=548&pickup_date=2026-10-15&pickup_time=11%3A30&dropoff_date=2026-10-18&dropoff_time=12%3A00&drivers_age=23&residence_country=us&currency=USD');

describe('provider-observed rental search context', () => {
  it('accepts the actual locations and station-local times without depending on session IDs', () => {
    expect(JSON.parse(verifyCarProviderContext(discoverUrl(discover), 'discovercars', search))).toMatchObject({ age: 23, pickupAt: '2026-10-15T11:30:00' });
    expect(JSON.parse(verifyCarProviderContext(auto().href, 'autoeurope', search))).toMatchObject({ pickup: '547', residence: 'US' });
  });
  it.each(['PickupLocationId', 'DropOffLocationId', 'PickupDateTime', 'DropOffDateTime', 'DriverAge', 'ResidenceCountry'])('rejects a changed DiscoverCars %s', field => {
    expect(() => verifyCarProviderContext(discoverUrl({ ...discover, [field]: 'changed' }), 'discovercars', search)).toThrow(/changed/);
  });
  it.each(['pickup_location', 'dropoff_location', 'pickup_date', 'pickup_time', 'dropoff_date', 'dropoff_time', 'drivers_age', 'residence_country', 'currency'])('rejects a changed Auto Europe %s', field => {
    const url = auto(); url.searchParams.set(field, 'changed');
    expect(() => verifyCarProviderContext(url.href, 'autoeurope', search)).toThrow(/changed/);
  });
  it('rejects missing context, malformed data and cross-provider redirects', () => {
    expect(() => verifyCarProviderContext('https://www.discovercars.com/', 'discovercars', search)).toThrow(/context/);
    expect(() => verifyCarProviderContext(discoverUrl([]), 'discovercars', search)).toThrow(/context/);
    expect(() => verifyCarProviderContext(auto().href, 'discovercars', search)).toThrow(/provider/);
  });
});
