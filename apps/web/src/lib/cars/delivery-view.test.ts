import { describe, expect, it } from 'vitest';
import { carDeliveryView, validateCarDeliveryView } from './delivery-view';
import { CarError } from './types';

const now = new Date('2026-09-07T12:00:00.000Z');
function row() {
  return { id: 'event-one', carTrackerId: 'tracker-one', createdAt: now, pending: true, deliveredIds: [] as string[], lastError: null as string | null, nextAttemptAt: now, claimExpiresAt: null as Date | null };
}
describe('private rental notification summaries', () => {
  it('shows waiting, claimed and expired-claim retry states without inferring delivery', () => {
    expect(carDeliveryView(row(), 'tracker-one', now)).toMatchObject({ status: 'waiting', acknowledgedChannels: 0 });
    const pending = { ...row(), claimExpiresAt: new Date(now.getTime() + 60_000), lastError: 'Raw secret-bearing error' };
    expect(carDeliveryView(pending, 'tracker-one', now).status).toBe('claimed');
    expect(carDeliveryView(pending, 'tracker-one', new Date(now.getTime() + 60_001)).status).toBe('retrying');
  });
  it('counts unique recorded acknowledgements without exposing recipients or errors', () => {
    const summary = carDeliveryView({ ...row(), deliveredIds: ['private-channel', 'private-channel'], lastError: 'Bearer private-token' }, 'tracker-one', now);
    expect(summary).toEqual({ id: 'event-one', trackerId: 'tracker-one', status: 'retrying', acknowledgedChannels: 1, createdAt: now.toISOString(), nextAttemptAt: now.toISOString() });
    expect(JSON.stringify(summary)).not.toMatch(/private-channel|private-token|lastError|deliveredIds/);
  });
  it('distinguishes completed acceptance from stopped delivery with earlier acknowledgements', () => {
    const delivered = { ...row(), pending: false, deliveredIds: ['one'] };
    expect(carDeliveryView(delivered, 'tracker-one', now)).toMatchObject({ status: 'accepted', nextAttemptAt: null });
    expect(carDeliveryView({ ...delivered, lastError: 'Tracker paused' }, 'tracker-one', now)).toMatchObject({ status: 'stopped', acknowledgedChannels: 1, nextAttemptAt: null });
    expect(() => carDeliveryView({ ...row(), pending: false }, 'tracker-one', now)).toThrow(CarError);
  });
  it.each([
    { trackerId: 'another' }, { status: 'delivered-to-human' }, { acknowledgedChannels: -1 }, { acknowledgedChannels: 0.5 },
    { acknowledgedChannels: Number.MAX_SAFE_INTEGER + 1 }, { nextAttemptAt: null }, { createdAt: 'invalid' },
    { status: 'accepted', acknowledgedChannels: 0, nextAttemptAt: null }, { status: 'stopped' },
  ])('rejects inconsistent notification data: %j', change => {
    expect(() => validateCarDeliveryView({ ...carDeliveryView(row(), 'tracker-one', now), ...change }, 'tracker-one')).toThrow(CarError);
  });
});
