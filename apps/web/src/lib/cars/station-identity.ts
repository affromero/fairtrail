import { createHash } from 'node:crypto';
import { carText } from './validation';
import type { CarSource } from './types';

/** An explicit address-based match, never presented as a provider-issued branch ID. */
export function carAddressStationIdentity(source: CarSource, supplierId: string, locationId: string, address: string): string {
  const normalized = carText(address.normalize('NFC').replace(/\s+/g, ' ').trim(), 2000, 'rental office address');
  const key = JSON.stringify([source, carText(supplierId, 200, 'supplier ID'), carText(locationId, 200, 'location ID'), normalized]);
  return `derived-station-v1:${createHash('sha256').update(key).digest('hex')}`;
}
