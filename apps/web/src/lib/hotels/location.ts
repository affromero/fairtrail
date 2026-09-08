import type { HotelLocation } from './types';

/** Historical results and unverified property locations remain list-only. */
export function hotelLocation(value: unknown, propertyId: string): HotelLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const location = value as Record<string, unknown>;
  const { latitude, longitude } = location;
  if (!propertyId || location.propertyId !== propertyId) return null;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, propertyId };
}
