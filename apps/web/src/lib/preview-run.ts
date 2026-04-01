import type { PriceData } from '@/lib/scraper/extract-prices';

export interface PreviewRequestPayload {
  dateFrom: string;
  dateTo: string;
  maxPrice: number | null;
  maxStops: number | null;
  preferredAirlines: string[];
  timePreference: string;
  cabinClass: string;
  tripType: string;
  currency: string | null;
  outboundDates?: string[];
  returnDates?: string[];
  origins: Array<{ code: string; name: string }>;
  destinations: Array<{ code: string; name: string }>;
  origin?: string;
  originName?: string;
  destination?: string;
  destinationName?: string;
}

export interface RouteResultPayload {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  flights: PriceData[];
  date?: string;
  returnDate?: string;
  error?: string;
}

export interface PreviewResultPayload {
  routes: RouteResultPayload[];
  flights?: PriceData[];
}

export interface PreviewRunStatusPayload {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: PreviewResultPayload | null;
  error: string | null;
  expiresAt: string;
}
