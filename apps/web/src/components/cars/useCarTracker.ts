'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateCarDetailView, type CarDetailView } from '@/lib/cars/detail-view';
import { validateCarTrackerView } from '@/lib/cars/tracker-view';
import { carRunIsActive } from '@/lib/cars/run-view';
import { carRecord } from '@/lib/cars/validation';
import { travelRequest, TravelResponseError } from '../travel/client';
import { carManagementAction, carManagementBody, carManagementMatches, restoreCarManagement, type CarManagementAction, type CarManagementIntent } from './management';

type Phase = 'loading' | 'ready' | 'uncertain' | 'conflict' | 'inaccessible' | 'deleted' | 'storage_error';
interface State { detail: CarDetailView; busy: boolean; interrupted: boolean; hidden: boolean; phase: Phase; pending: CarManagementIntent | null; notice: 'currentSettings' | 'currentStateAccepted' | 'settingsSaved' | null; error: string }

/** A single generation boundary owns both polling and mutation reconciliation. */
export function useCarTracker(initial: CarDetailView, actorScope: string) {
  const [state, setState] = useState<State>({ detail: initial, busy: false, interrupted: false, hidden: false, phase: 'loading', pending: null, notice: null, error: '' });
  const current = useRef(state), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const storageKey = `ff-car-management:${encodeURIComponent(actorScope)}:${encodeURIComponent(initial.tracker.id)}`;
  const url = `/api/cars/${encodeURIComponent(initial.tracker.id)}`;
  const update = useCallback((patch: Partial<State>) => { current.current = { ...current.current, ...patch }; setState(current.current); }, []);
  const removePending = useCallback(() => {
    try { sessionStorage.removeItem(storageKey); return true; }
    catch { return false; }
  }, [storageKey]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey), pending = raw === null ? null : restoreCarManagement(raw, initial.tracker);
      update({ phase: pending ? 'uncertain' : 'ready', pending });
    } catch { update({ phase: 'storage_error' }); }
    return () => { generation.current++; controller.current?.abort(); controller.current = null; };
  }, [storageKey, initial.tracker, update]);

  const validateNext = useCallback((raw: unknown) => {
    const next = validateCarDetailView(raw, initial.tracker.id), previous = current.current.detail;
    if (next.tracker.createdAt !== initial.tracker.createdAt || JSON.stringify(next.tracker.search) !== JSON.stringify(initial.tracker.search) || JSON.stringify(next.tracker.selection) !== JSON.stringify(initial.tracker.selection) || next.tracker.revision < previous.tracker.revision || next.tracker.updatedAt < previous.tracker.updatedAt) throw new Error('Rental history identity or revision changed unexpectedly');
    for (const run of next.runs) {
      const prior = previous.runs.find(value => value.id === run.id);
      if (prior && ((!carRunIsActive(prior) && (prior.status !== run.status || prior.completedAt !== run.completedAt)) || (prior.status === 'running' && run.status === 'queued'))) throw new Error('Rental check status moved backwards');
    }
    return next;
  }, [initial.tracker]);
  const reconcile = useCallback((detail: CarDetailView, acknowledged = false) => {
    const pending = current.current.pending;
    update({ detail, hidden: false, interrupted: false, error: '' });
    if (!pending) {
      try {
        const saved = sessionStorage.getItem(storageKey), restored = saved === null ? null : restoreCarManagement(saved, detail.tracker);
        update({ phase: restored ? 'uncertain' : 'ready', pending: restored });
      } catch { update({ phase: 'storage_error' }); }
      return;
    }
    if (detail.tracker.revision <= pending.revision) { update({ phase: 'uncertain' }); return; }
    if (!carManagementMatches(pending.action, detail.tracker)) { update({ phase: 'conflict' }); return; }
    if (!removePending()) { update({ phase: 'storage_error' }); return; }
    update({ phase: 'ready', pending: null, notice: acknowledged ? 'settingsSaved' : 'currentSettings' });
  }, [removePending, storageKey, update]);

  const request = useCallback(async (pending: CarManagementIntent | null = null, recovering = false) => {
    const sequence = ++generation.current, aborter = new AbortController();
    controller.current?.abort(); controller.current = aborter;
    update({ busy: true, notice: null, error: '' });
    const timeout = setTimeout(() => aborter.abort(), 15_000);
    let acknowledged = false, reading = !pending;
    try {
      if (pending) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
        catch { update({ phase: 'storage_error', pending }); return; }
        try {
          const raw = carRecord(await travelRequest<unknown>(url, { method: pending.action.kind === 'delete' ? 'DELETE' : 'PATCH', headers: { 'X-Car-Revision': String(pending.revision) }, body: JSON.stringify(carManagementBody(pending.action)), signal: aborter.signal }));
          if (sequence !== generation.current) return;
          if (aborter.signal.aborted) throw new Error('Rental action exceeded its deadline');
          if (pending.action.kind === 'delete') {
            if (raw.id !== pending.trackerId || raw.deleted !== true) throw new Error('Deletion acknowledgement is inconsistent');
            removePending(); update({ phase: 'deleted', hidden: true, pending: null, interrupted: false }); return;
          }
          const tracker = validateCarTrackerView(raw.tracker);
          if (tracker.id !== pending.trackerId || tracker.revision !== pending.revision + 1 || !carManagementMatches(pending.action, tracker)) throw new Error('Settings acknowledgement is inconsistent');
          acknowledged = true;
        } catch (error) {
          if (!(error instanceof TravelResponseError && error.definitive && error.status === 412)) throw error;
        }
      }
      reading = true;
      const next = validateNext(await travelRequest<unknown>(url, { cache: 'no-store', signal: aborter.signal }));
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted) throw new Error('Rental history request exceeded its deadline');
      reconcile(next, acknowledged);
    } catch (error) {
      if (sequence !== generation.current) return;
      const status = error instanceof TravelResponseError ? error.status : 0;
      if (reading && status === 404 && error instanceof TravelResponseError && error.definitive) {
        removePending(); update({ phase: 'inaccessible', hidden: true, interrupted: true, pending: null }); return;
      }
      const hidden = current.current.hidden || [401, 403, 404].includes(status);
      if (pending && !recovering && !reading && !aborter.signal.aborted && error instanceof TravelResponseError && error.definitive && [400, 409, 413, 415, 429].includes(status)) {
        if (!removePending()) { update({ phase: 'storage_error', pending }); return; }
        update({ phase: 'ready', pending: null, error: error instanceof Error ? error.message : '', hidden }); return;
      }
      update({ interrupted: true, hidden, ...(current.current.pending ? { phase: 'uncertain' } : {}), error: '' });
    } finally {
      clearTimeout(timeout);
      if (controller.current === aborter) controller.current = null;
      if (sequence === generation.current) update({ busy: false });
    }
  }, [reconcile, removePending, storageKey, update, url, validateNext]);
  const read = useCallback(() => request(), [request]);
  useEffect(() => {
    if (state.busy || state.interrupted || state.hidden || state.phase !== 'ready' || !state.detail.runs.some(carRunIsActive)) return;
    const timeout = setTimeout(() => void read(), 1500);
    return () => clearTimeout(timeout);
  }, [state, read]);

  async function mutate(action: CarManagementAction, expectedRevision = current.current.detail.tracker.revision) {
    const value = current.current;
    if (value.phase !== 'ready' || value.interrupted || value.hidden || expectedRevision !== value.detail.tracker.revision || expectedRevision >= 2147483647) return;
    const normalized = carManagementAction(action, value.detail.tracker);
    if (normalized.kind === 'owner' && !value.detail.canReassign) return;
    const pending: CarManagementIntent = { trackerId: initial.tracker.id, revision: expectedRevision, action: normalized };
    update({ pending, phase: 'uncertain' });
    await request(pending);
  }
  async function retry() {
    const value = current.current;
    if (value.busy || !value.pending || value.hidden || !['uncertain', 'storage_error'].includes(value.phase)) return;
    await request(value.pending, true);
  }
  function acceptCurrent() {
    const value = current.current;
    if (value.busy || !value.pending || value.detail.tracker.revision <= value.pending.revision) return;
    if (!removePending()) { update({ phase: 'storage_error' }); return; }
    update({ phase: 'ready', pending: null, notice: 'currentStateAccepted', interrupted: false });
  }
  async function recoverStorage() {
    if (current.current.busy || !['storage_error', 'uncertain'].includes(current.current.phase) || current.current.hidden) return;
    const sequence = generation.current + 1;
    await request();
    if (sequence !== generation.current) return;
    const value = current.current;
    if (!['storage_error', 'uncertain'].includes(value.phase) || value.interrupted || value.hidden || (value.pending && value.detail.tracker.revision !== value.pending.revision) || value.detail.tracker.revision >= 2147483647) return;
    const pending: CarManagementIntent = { trackerId: initial.tracker.id, revision: value.detail.tracker.revision, action: { kind: 'active', active: false } };
    update({ pending, phase: 'uncertain' });
    await request(pending, true);
  }
  return { ...state, read, mutate, retry, acceptCurrent, recoverStorage, locked: state.phase !== 'ready' || state.interrupted || state.hidden };
}
