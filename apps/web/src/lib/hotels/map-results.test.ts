import { expect, it } from 'vitest';
import { hotelMapProperties, hotelMapStayKey, hotelMapStayOffers } from './map-results';
import type { HotelOffer } from './types';

const offer: HotelOffer = {
  id: 'one', source: 'booking', propertyId: 'hotel', hotelName: 'Hotel', address: '', imageUrl: null,
  propertyUrl: 'https://www.booking.com/hotel/gb/hotel.html', bookingUrl: 'https://www.booking.com/hotel/gb/hotel.html',
  seller: 'Booking.com', roomName: 'Double', rateName: null, totalPrice: 300, currency: 'GBP', taxesIncluded: true,
  occupancyVerified: true, rooms: [{ adults: 2, children: [] }], refundable: true, breakfast: null,
  stars: null, rating: null, amenities: {}, match: 'approximate', checkIn: '2027-01-01', checkOut: '2027-01-04',
  location: { propertyId: 'hotel', latitude: 51, longitude: 0 },
};

it('keeps co-located and same-named properties independently selectable', () => {
  const other = { ...offer, id: 'two', propertyId: 'another', location: { ...offer.location!, propertyId: 'another' } };
  expect(hotelMapProperties([offer, other]).map(property => property.offers.map(entry => entry.id))).toEqual([['one'], ['two']]);
});

it('does not map conflicting property evidence or invent a position for missing evidence', () => {
  expect(hotelMapProperties([offer, { ...offer, id: 'conflict', location: { ...offer.location!, latitude: 52 } }])).toEqual([]);
  expect(hotelMapProperties([{ ...offer, location: null }])).toEqual([]);
});

it('compares prices only for the selected dates, currency and guests', () => {
  const alternatives = [offer, { ...offer, id: 'cheaper', totalPrice: 250 }, { ...offer, id: 'other-dates', checkIn: '2027-01-02', totalPrice: 100 }, { ...offer, id: 'other-currency', currency: 'EUR', totalPrice: 100 }, { ...offer, id: 'other-guests', rooms: [{ adults: 1, children: [] }], totalPrice: 100 }];
  const property = hotelMapProperties(alternatives)[0]!;
  expect(hotelMapStayOffers(property, hotelMapStayKey(offer)).map(entry => entry.id)).toEqual(['cheaper', 'one']);
  expect(alternatives.map(entry => entry.id)).toEqual(['one', 'cheaper', 'other-dates', 'other-currency', 'other-guests']);
});
