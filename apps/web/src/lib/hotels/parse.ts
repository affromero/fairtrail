import { validateHotelSearch } from './domain';
import type { HotelSearch } from './types';
import { travelJson as hotelJson } from '../travel/ai-json';
export { hotelJson };

export async function parseHotelQuery(text: string): Promise<HotelSearch> {
  if (!text.trim() || text.length > 4000) throw new Error('Describe a hotel search in 1–4000 characters');
  const raw = await hotelJson(`Parse a hotel-only search into JSON. Today is ${new Date().toISOString().slice(0, 10)}.
Return {destination,dateMode,checkIn,checkOut,flexibility,minNights,maxNights,rooms,currency,sources,filters}.
Dates are YYYY-MM-DD. dateMode is fixed, nearby (vary check-in and check-out independently +/- flexibility days), or window (earliest arrival checkIn, latest departure checkOut, minNights/maxNights).
rooms is [{adults:2,children:[]}] only when no occupancy is specified. Preserve every requested adult and child in the requested room. children contains one entry per child: their integer age when specified, otherwise null so validation requests the missing age. Never omit a child, treat a child as an adult, or invent an age. Example: two adults, an eight-year-old and another child gives [{adults:2,children:[8,null]}]. Currency defaults USD. sources defaults ["google_hotels","booking"].
filters is {maxTotal:null,refundable:false,breakfast:false,minStars:0,minRating:0,excludedSellers:[],amenities:[]} with amenities limited to parking,pool,pets,accessible. Rating uses 0–10. Budget is TOTAL stay for ALL rooms.
Use flexibility 0 and minNights/maxNights equal to stay length for fixed dates. Missing destination or dates must remain empty strings so validation requests clarification. Never infer a flight or airport. Output JSON only.`, text, 'hotel_parse');
  return validateHotelSearch(raw);
}
