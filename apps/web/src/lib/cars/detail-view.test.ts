import { describe, expect, it } from 'vitest';
import { carOfferFixture, carTrackerViewFixture } from '@/test/car-fixtures';
import { validateCarDetailView } from './detail-view';
import { carContractHash } from './selection';
import { CarError } from './types';

function detail() {
  const tracker = carTrackerViewFixture(), offer = carOfferFixture(), observedAt = offer.observedAt;
  const observation = { id: 'observation-one', runId: 'run-one', source: offer.contract.source, offer, currency: offer.contract.currency, totalMinor: 10000, eligible: true, reasons: [] as string[], contractHash: carContractHash(offer.contract), observedAt, evaluatedAt: observedAt };
  return { tracker, snapshots: [observation], latestObservation: observation, runs: [{ id: 'run-one', trackerId: tracker.id, status: 'success', createdAt: observedAt, completedAt: observedAt, error: null }], deliveries: [], notificationsConfigured: false, canReassign: false };
}
describe('rental tracker detail validation', () => {
  it.each(['missing', 'duplicate', 'foreign', 'too-many'] as const)('rejects %s delivery history rather than displaying unverified outcomes', kind => {
    const value = detail(), delivery = { id: 'delivery-one', trackerId: value.tracker.id, status: 'waiting', acknowledgedChannels: 0, createdAt: value.tracker.createdAt, nextAttemptAt: value.tracker.createdAt };
    const deliveries = kind === 'missing' ? undefined : kind === 'duplicate' ? [delivery, delivery] : kind === 'foreign' ? [{ ...delivery, trackerId: 'another' }] : Array.from({ length: 21 }, (_, index) => ({ ...delivery, id: `delivery-${index}` }));
    expect(() => validateCarDetailView({ ...value, deliveries }, value.tracker.id)).toThrow(CarError);
  });
  it('keeps historical eligibility anchored to evaluation time rather than the current clock', () => {
    const value = detail(), old = new Date(Date.now() - 86_400_000).toISOString(), offer = carOfferFixture(old);
    value.snapshots[0]!.offer = offer; value.snapshots[0]!.observedAt = old; value.snapshots[0]!.evaluatedAt = old;
    expect(validateCarDetailView(value, value.tracker.id).latestObservation).toMatchObject({ eligible: true, totalMinor: 10000, observedAt: old });
  });
  it('keeps ineligible observations visible without promoting them to verified history', () => {
    const value = detail(); value.latestObservation = { ...value.latestObservation };
    value.snapshots[0] = { ...value.snapshots[0]!, eligible: false, reasons: ['Excluded by the saved check'] };
    expect(validateCarDetailView(value, value.tracker.id).snapshots[0]).toMatchObject({ eligible: false, reasons: ['Excluded by the saved check'] });
  });
  it('rejects an eligible flag on a mismatched selected rental contract', () => {
    const value = detail();
    const tracker = { ...value.tracker, options: { ...value.tracker.options, mode: 'contract' }, selection: { source: 'discovercars', contractHash: 'b'.repeat(64) } };
    expect(() => validateCarDetailView({ ...value, tracker }, tracker.id)).toThrow(CarError);
  });
  it.each(['identity', 'money', 'flag', 'timestamp', 'run', 'duplicate', 'unverified'] as const)('rejects malformed %s without displaying partial trusted history', kind => {
    const value = detail();
    if (kind === 'identity') value.tracker.id = 'another-tracker';
    if (kind === 'money') value.snapshots[0]!.totalMinor = 10001;
    if (kind === 'flag') value.notificationsConfigured = 'true' as unknown as boolean;
    if (kind === 'timestamp') value.snapshots[0]!.evaluatedAt = '2020-01-01T00:00:00.000Z';
    if (kind === 'run') value.runs[0]!.trackerId = 'another-tracker';
    if (kind === 'duplicate') value.snapshots.push(value.snapshots[0]!);
    if (kind === 'unverified') value.latestObservation.eligible = false;
    expect(() => validateCarDetailView(value, 'tracker-one')).toThrow(CarError);
  });
  it('does not invent an observation when a tracker has no stored quote evidence', () => {
    const value = detail();
    expect(validateCarDetailView({ ...value, latestObservation: null, snapshots: [], runs: [] }, value.tracker.id)).toMatchObject({ latestObservation: null, snapshots: [], runs: [] });
  });
});
