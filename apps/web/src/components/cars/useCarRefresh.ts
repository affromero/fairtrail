'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { carInteger, carRecord, carText } from '@/lib/cars/validation';
import { travelRequest, TravelResponseError } from '../travel/client';

interface Pending { key: string; trackerId: string; revision: number }
interface Result { id: string; status: string }
type Phase = 'loading' | 'ready' | 'sending' | 'uncertain' | 'storage_error' | 'accepted' | 'removed' | 'rejected';
interface State { phase: Phase; pending: Pending | null; result: Result | null }
const initial: State = { phase: 'loading', pending: null, result: null };

function restore(raw: string, trackerId: string): Pending {
  const value = carRecord(JSON.parse(raw));
  if (value.trackerId !== trackerId || Object.keys(value).some(key => !['key', 'trackerId', 'revision'].includes(key))) throw new Error('Refresh identity changed');
  return { key: validateCarCreationKey(value.key), trackerId, revision: carInteger(value.revision, 0, 2147483647, 'Tracker revision') };
}

export function useCarRefresh(trackerId: string, actorScope: string, onAccepted: () => void, onAccessLost: () => void) {
  const [state, setState] = useState<State>(initial), current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const callback = useRef(onAccepted); callback.current = onAccepted;
  const accessCallback = useRef(onAccessLost); accessCallback.current = onAccessLost;
  const storageKey = `ff-car-refresh:${encodeURIComponent(actorScope)}:${encodeURIComponent(trackerId)}`;
  const update = useCallback((value: State) => { current.current = value; setState(value); }, []);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey), pending = saved === null ? null : restore(saved, trackerId);
      update({ ...initial, pending, phase: pending ? 'uncertain' : 'ready' });
    } catch { update({ ...initial, phase: 'storage_error' }); }
    return () => { generation.current++; controller.current?.abort(); };
  }, [storageKey, trackerId, update]);
  async function send(pending: Pending, recovering: boolean) {
    const sequence = generation.current, aborter = new AbortController(); controller.current = aborter;
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
    catch { update({ ...initial, phase: 'storage_error', pending }); return; }
    update({ ...initial, phase: 'sending', pending });
    const timer = setTimeout(() => {
      if (sequence !== generation.current) return;
      generation.current++; aborter.abort(); controller.current = null;
      update({ ...initial, phase: 'uncertain', pending });
    }, 15_000);
    try {
      const raw = carRecord(await travelRequest<unknown>(`/api/cars/${encodeURIComponent(trackerId)}/scrape`, { method: 'POST', headers: { 'Idempotency-Key': pending.key, 'X-Car-Revision': String(pending.revision) }, signal: aborter.signal }));
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted || raw.refreshKey !== pending.key || raw.trackerId !== pending.trackerId || !['queued', 'running', 'success', 'partial', 'failed', 'cancelled', 'unavailable'].includes(String(raw.status))) throw new Error('Refresh acknowledgement is inconsistent');
      const result = { id: carText(raw.id, 200, 'check identity'), status: String(raw.status) };
      try { sessionStorage.removeItem(storageKey); }
      catch { update({ phase: 'storage_error', pending, result }); callback.current(); return; }
      update({ phase: 'accepted', pending: null, result }); callback.current();
    } catch (error) {
      if (sequence !== generation.current) return;
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) {
        update({ ...initial, phase: 'uncertain', pending }); accessCallback.current(); return;
      }
      const definitive = !aborter.signal.aborted && error instanceof TravelResponseError && error.definitive;
      const terminal = definitive && (error.status === 410 || error.status === 412 || (!recovering && [400, 404, 409, 428, 429].includes(error.status)));
      if (!terminal) { update({ ...initial, phase: 'uncertain', pending }); return; }
      try { sessionStorage.removeItem(storageKey); }
      catch { update({ ...initial, phase: 'storage_error', pending }); return; }
      update({ ...initial, phase: error.status === 410 ? 'removed' : 'rejected' });
      callback.current();
    } finally { clearTimeout(timer); if (controller.current === aborter) controller.current = null; }
  }
  async function start(revision: number) {
    if (!['ready', 'accepted', 'removed', 'rejected'].includes(current.current.phase)) return;
    await send({ key: crypto.randomUUID(), trackerId, revision }, false);
  }
  async function retry() {
    if (!['uncertain', 'storage_error'].includes(current.current.phase) || !current.current.pending) return;
    await send(current.current.pending, true);
  }
  function recoverStorage() {
    if (current.current.phase !== 'storage_error') return;
    try {
      const pending = current.current.pending;
      if (pending) { sessionStorage.setItem(storageKey, JSON.stringify(pending)); update({ ...initial, pending, phase: 'uncertain' }); return; }
      const saved = sessionStorage.getItem(storageKey), restored = saved === null ? null : restore(saved, trackerId);
      update({ ...initial, pending: restored, phase: restored ? 'uncertain' : 'ready' });
    } catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  function discardUnreadable() {
    if (current.current.phase !== 'storage_error' || current.current.pending) return;
    try { sessionStorage.removeItem(storageKey); update({ ...initial, phase: 'ready' }); }
    catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  return { ...state, start, retry, recoverStorage, discardUnreadable, locked: !['ready', 'accepted', 'removed', 'rejected'].includes(state.phase) };
}
