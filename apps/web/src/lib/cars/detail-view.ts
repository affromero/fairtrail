import { carRecord, carText } from './validation';
import { validateCarOffer } from './offer-validation';
import { validateCarMoney } from './money';
import { validateCarSelection } from './identity';
import { assessCarPrice } from './pricing';
import { carViewBoolean, carViewTime, validateCarTrackerView, type CarTrackerView } from './tracker-view';
import { validateCarRunSummary } from './run-view';
import { CarError } from './types';

function boundedList(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > maximum) throw new CarError('Rental history exceeds its view bounds');
  return raw;
}
/** Server serializers verify the canonical contract hash before sharing this view. */
export function validateCarSnapshotView(raw: unknown, tracker: CarTrackerView) {
  const row = carRecord(raw), observedAt = carViewTime(row.observedAt), evaluatedAt = carViewTime(row.evaluatedAt);
  const offer = validateCarOffer(row.offer, new Date(observedAt)), identity = validateCarSelection({ source: row.source, contractHash: row.contractHash });
  if (row.currency !== tracker.currency || offer.contract.currency !== row.currency || offer.contract.source !== identity.source || offer.observedAt !== observedAt || Date.parse(observedAt) > Date.parse(evaluatedAt) + 5000) throw new CarError('Stored rental observation is inconsistent');
  const totalMinor = row.totalMinor === null ? null : validateCarMoney({ currency: row.currency, minor: row.totalMinor }).minor;
  const eligible = carViewBoolean(row.eligible), assessment = assessCarPrice(offer, tracker.search, new Date(evaluatedAt));
  const matches = !tracker.selection || (tracker.selection.source === identity.source && tracker.selection.contractHash === identity.contractHash);
  if (totalMinor !== (assessment.total?.minor ?? null) || (eligible && (!assessment.eligible || !matches))) throw new CarError('Stored rental price or eligibility is inconsistent');
  return { id: carText(row.id, 200, 'observation identity'), runId: carText(row.runId, 200, 'check identity'), ...identity, offer, currency: tracker.currency, totalMinor, eligible,
    reasons: boundedList(row.reasons, 200).map(reason => carText(reason, 16000, 'exclusion reason')), observedAt, evaluatedAt };
}
export function validateCarDetailView(raw: unknown, expectedId: string) {
  const value = carRecord(raw), tracker = validateCarTrackerView(value.tracker);
  if (tracker.id !== expectedId) throw new CarError('Rental history belongs to another tracker');
  const snapshots = boundedList(value.snapshots, 100).map(raw => validateCarSnapshotView(raw, tracker));
  const runs = boundedList(value.runs, 20).map(raw => validateCarRunSummary(raw));
  if (runs.some(run => run.trackerId !== tracker.id) || new Set(runs.map(run => run.id)).size !== runs.length || new Set(snapshots.map(snapshot => snapshot.id)).size !== snapshots.length) throw new CarError('Rental history identities are inconsistent');
  const latestObservation = value.latestObservation === null ? null : validateCarSnapshotView(value.latestObservation, tracker);
  if (latestObservation && (!latestObservation.eligible || latestObservation.totalMinor !== tracker.latestPriceMinor)) throw new CarError('Retained rental price has inconsistent evidence');
  return { tracker, snapshots, runs, latestObservation, notificationsConfigured: carViewBoolean(value.notificationsConfigured), canReassign: carViewBoolean(value.canReassign) };
}
export type CarDetailView = ReturnType<typeof validateCarDetailView>;
