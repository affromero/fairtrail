import { carInteger, carRecord, carText, validateCarOptions } from '@/lib/cars/validation';
import { carViewBoolean, type CarTrackerView } from '@/lib/cars/tracker-view';
import { CarError, type CarTrackingOptions } from '@/lib/cars/types';

export type CarManagementAction = { kind: 'settings'; options: CarTrackingOptions; label?: string } | { kind: 'active'; active: boolean } | { kind: 'owner'; userId: string } | { kind: 'delete' };
export interface CarManagementIntent { trackerId: string; revision: number; action: CarManagementAction }

export function carManagementAction(raw: unknown, tracker: CarTrackerView): CarManagementAction {
  const value = carRecord(raw);
  if (value.kind === 'delete') return { kind: 'delete' };
  if (value.kind === 'active') return { kind: 'active', active: carViewBoolean(value.active) };
  if (value.kind === 'owner') return { kind: 'owner', userId: carText(value.userId, 200, 'tracker owner') };
  if (value.kind !== 'settings') throw new CarError('Unknown rental management action');
  const input = carRecord(value.options);
  if (input.mode === undefined || input.target === undefined || input.notifyLows === undefined || input.scrapeInterval === undefined) throw new CarError('Saved rental settings are incomplete');
  const options = validateCarOptions(input, tracker.currency);
  if (options.mode !== tracker.options.mode) throw new CarError('Create a new tracker to change offer matching');
  return { kind: 'settings', options, ...(value.label === undefined ? {} : { label: carText(value.label, 250, 'tracker label') }) };
}
export function restoreCarManagement(raw: string, tracker: CarTrackerView): CarManagementIntent {
  const value = carRecord(JSON.parse(raw));
  if (value.trackerId !== tracker.id) throw new CarError('Saved action belongs to another tracker');
  return { trackerId: tracker.id, revision: carInteger(value.revision, 0, Math.min(tracker.revision, 2147483646), 'Saved settings revision'), action: carManagementAction(value.action, tracker) };
}
export function carManagementBody(action: CarManagementAction) {
  if (action.kind === 'delete') return undefined;
  if (action.kind === 'active') return { active: action.active };
  if (action.kind === 'owner') return { userId: action.userId };
  const { target, notifyLows, scrapeInterval } = action.options;
  return { target, notifyLows, scrapeInterval, ...(action.label === undefined ? {} : { label: action.label }) };
}
export function carManagementMatches(action: CarManagementAction, tracker: CarTrackerView): boolean {
  if (action.kind === 'delete') return false;
  if (action.kind === 'active') return action.active === tracker.active;
  if (action.kind === 'owner') return action.userId === tracker.userId;
  return action.options.mode === tracker.options.mode && action.options.target?.minor === tracker.options.target?.minor && action.options.notifyLows === tracker.options.notifyLows && action.options.scrapeInterval === tracker.options.scrapeInterval && (action.label === undefined || action.label === tracker.label);
}
