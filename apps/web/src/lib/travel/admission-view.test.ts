import { describe, expect, it } from 'vitest';
import { validateTravelAdmissionView } from './admission-view';

const view = { actorScope: 'user:admin', quarantinedAt: null, reason: null, recoveryGeneration: 0, topologyVersion: 1,
  systemWide: false, vpnEnabled: false, leases: [{ id: 'browser', state: 'idle', generation: 0, expiresAt: '1970-01-01T00:00:00.000Z' }] };
describe('bounded administrator recovery status', () => {
  it('retains resource and generation information without accepting lease credentials', () => {
    expect(validateTravelAdmissionView(view)).toEqual(view);
    expect(() => validateTravelAdmissionView({ ...view, leases: [{ ...view.leases[0], owner: 'private-owner' }] })).toThrow(/status/);
  });
  it.each([
    { actorScope: 'user:../../admin' }, { recoveryGeneration: -1 }, { recoveryGeneration: 0.5 }, { topologyVersion: 2147483648 },
    { systemWide: true }, { vpnEnabled: 'false' }, { quarantinedAt: 'invalid' }, { reason: 'Not quarantined' },
    { quarantinedAt: '2026-09-07T12:00:00.000Z', reason: null },
    { quarantinedAt: '2026-09-07T12:00:00.000Z', reason: 'x'.repeat(1001) },
    { leases: [view.leases[0], view.leases[0]] },
    { leases: [{ ...view.leases[0], state: 'available' }] },
    { leases: [{ ...view.leases[0], state: ['idle'] }] },
    { leases: [{ ...view.leases[0], id: ['browser'] }] },
    { leases: [{ ...view.leases[0], expiresAt: '2026-09-07' }] },
    { leases: [{ ...view.leases[0], id: 'unknown-resource' }] },
  ])('rejects incoherent or unbounded status instead of authorizing recovery: %j', invalid => {
    expect(() => validateTravelAdmissionView({ ...view, ...invalid })).toThrow(/status/);
  });
});
