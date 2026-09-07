import { describe, expect, it } from 'vitest';
import { carAddressStationIdentity } from './station-identity';

describe('explicit address-based station matching', () => {
  const station = (supplier = '54', location = '1712', address = 'Airport Terminal 2') => carAddressStationIdentity('discovercars', supplier, location, address);
  it('ignores whitespace without pretending a derived key is a provider branch ID', () => {
    expect(station('54', '1712', ' Airport\n Terminal 2 ')).toBe(station());
    expect(station()).toMatch(/^derived-station-v1:/);
  });
  it.each([['55', '1712', 'Airport Terminal 2'], ['54', '1600', 'Airport Terminal 2'], ['54', '1712', 'Airport Terminal 3']])('keeps supplier, location and physical office changes distinct', (supplier, location, address) => {
    expect(station(supplier, location, address)).not.toBe(station());
  });
  it('rejects missing addresses instead of falling back to an entire airport', () => {
    expect(() => station('54', '1712', ' ')).toThrow(/address/);
  });
});
