import { carProviderUrl } from './offer-validation';
import { carRecord } from './validation';
import { CarError, type CarSearch, type CarSource } from './types';

/** Bind an observation to the provider's actual request, not our intended input. */
export function verifyCarProviderContext(rawUrl: string, source: CarSource, search: CarSearch): string {
  const url = new URL(carProviderUrl(rawUrl, source));
  let actual: Record<string, unknown>;
  if (source === 'discovercars') {
    const encoded = url.searchParams.get('sq');
    if (!encoded || encoded.length > 16000) throw new CarError('Provider omitted its rental search context');
    let decoded: Record<string, unknown>;
    try { decoded = carRecord(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))); }
    catch { throw new CarError('Provider returned an invalid rental search context'); }
    actual = {
      pickup: String(decoded.PickupLocationId), dropoff: String(decoded.DropOffLocationId),
      pickupAt: decoded.PickupDateTime, dropoffAt: decoded.DropOffDateTime,
      age: decoded.DriverAge, residence: decoded.ResidenceCountry,
    };
  } else {
    actual = {
      pickup: url.searchParams.get('pickup_location'), dropoff: url.searchParams.get('dropoff_location'),
      pickupAt: `${url.searchParams.get('pickup_date')}T${url.searchParams.get('pickup_time')}:00`,
      dropoffAt: `${url.searchParams.get('dropoff_date')}T${url.searchParams.get('dropoff_time')}:00`,
      age: Number(url.searchParams.get('drivers_age')), residence: url.searchParams.get('residence_country')?.toUpperCase(),
    };
    if (url.searchParams.get('currency') !== search.currency) throw new CarError('Provider changed the requested currency');
  }
  const expected = {
    pickup: search.pickup.providerIds[source], dropoff: search.dropoff.providerIds[source],
    pickupAt: `${search.pickupAt.date}T${search.pickupAt.time}:00`, dropoffAt: `${search.dropoffAt.date}T${search.dropoffAt.time}:00`,
    age: search.driver.age, residence: search.driver.residenceCountry,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined || actual[key] !== value) throw new CarError(`Provider changed the requested rental ${key}`);
  }
  return JSON.stringify(expected);
}
