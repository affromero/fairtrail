import { hotelLocation } from './location';
import type { HotelLocation, HotelOffer } from './types';

export interface HotelMapProperty {
  id: string;
  name: string;
  location: HotelLocation;
  offers: HotelOffer[];
}

/** Keep provider identities separate, even when names or coordinates coincide. */
export function hotelMapProperties(offers: HotelOffer[]): HotelMapProperty[] {
  const groups = new Map<string, HotelOffer[]>();
  for (const offer of offers) {
    const key = `${offer.source}:${offer.propertyId}`;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return [...groups.entries()].flatMap(([id, propertyOffers]) => {
    const first = propertyOffers[0]!;
    const locations = propertyOffers.map(offer => hotelLocation(offer.location, offer.propertyId)).filter(location => location !== null);
    const location = locations[0];
    if (!location || locations.some(point => point.latitude !== location.latitude || point.longitude !== location.longitude)) return [];
    return [{ id, name: first.hotelName, location, offers: propertyOffers }];
  });
}

/** A price comparison must refer to the same dates, currency and room allocation. */
export function hotelMapStayKey(offer: HotelOffer): string {
  return JSON.stringify([offer.checkIn, offer.checkOut, offer.currency, offer.rooms]);
}

export function hotelMapStayOffers(property: HotelMapProperty, stayKey: string): HotelOffer[] {
  return property.offers.filter(offer => hotelMapStayKey(offer) === stayKey)
    .sort((a, b) => a.totalPrice - b.totalPrice || a.id.localeCompare(b.id));
}
