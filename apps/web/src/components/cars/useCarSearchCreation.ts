'use client';
import { useEffect, useRef, useState } from 'react';
import { carProtectionInput, validateCarCreationKey } from '@/lib/cars/creation-input';
import { carRecord, carText } from '@/lib/cars/validation';
import { travelRequest, TravelResponseError } from '../travel/client';

interface Pending { key: string; body: Record<string, unknown> }
type Phase = 'loading' | 'ready' | 'sending' | 'uncertain' | 'storage_error' | 'created' | 'removed' | 'closing' | 'close_uncertain' | 'closed';
interface State { phase: Phase; pending: Pending | null; id: string | null; error: string }
const initial: State = { phase: 'loading', pending: null, id: null, error: '' };
interface ProtectionTarget { searchId: string; trackingClosed: boolean; onAccessLost?: () => void }
export const CAR_SEARCH_CREATION_TIMEOUT_MS = 15_000;
function restore(saved: string | null, protectedSearch: boolean): Pending | null {
  if (saved === null) return null;
  const raw = carRecord(JSON.parse(saved));
  return { key: validateCarCreationKey(raw.key), body: protectedSearch ? carProtectionInput(raw.body) : carRecord(raw.body) };
}

export function useCarSearchCreation(actorScope: string, target?: ProtectionTarget) {
  const [state, setState] = useState<State>(initial), current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const searchId = target?.searchId, serverClosed = target?.trackingClosed ?? false;
  const closed = useRef(serverClosed), accessLost = useRef(target?.onAccessLost); accessLost.current = target?.onAccessLost;
  const closure = useRef(serverClosed); closure.current = serverClosed;
  const storageKey = searchId === undefined ? `ff-car-search:${encodeURIComponent(actorScope)}` : `ff-car-protection:${encodeURIComponent(actorScope)}:${encodeURIComponent(searchId)}`;
  const endpoint = searchId === undefined ? '/api/cars/search' : `/api/cars/search/${encodeURIComponent(searchId)}/protection`;
  const update = (state: State) => { current.current = state; setState(state); };
  useEffect(() => {
    generation.current++;
    closed.current = closure.current;
    try {
      const pending = restore(sessionStorage.getItem(storageKey), searchId !== undefined);
      const next: State = { ...initial, pending, phase: pending ? 'uncertain' : closed.current ? 'closed' : 'ready' };
      current.current = next; setState(next);
    } catch { const next: State = { ...initial, phase: closed.current ? 'closed' : 'storage_error' }; current.current = next; setState(next); }
    return () => { generation.current++; controller.current?.abort(); };
  }, [storageKey, searchId]);
  useEffect(() => {
    if (!serverClosed) return;
    closed.current = true;
    if (!current.current.pending && !['created', 'closing'].includes(current.current.phase)) {
      const next: State = { ...initial, phase: 'closed' }; current.current = next; setState(next);
    }
  }, [serverClosed]);
  async function send(pending: Pending, recovering: boolean) {
    const sequence = generation.current, aborter = new AbortController(); controller.current = aborter;
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
    catch { update({ ...initial, phase: 'storage_error', pending }); return; }
    update({ ...initial, phase: 'sending', pending });
    const timer = setTimeout(() => {
      if (sequence !== generation.current) return;
      generation.current++; aborter.abort(); update({ ...initial, phase: 'uncertain', pending });
    }, CAR_SEARCH_CREATION_TIMEOUT_MS);
    try {
      const raw = carRecord(await travelRequest<unknown>(endpoint, { method: 'POST', body: JSON.stringify(pending.body), headers: { 'Idempotency-Key': pending.key }, signal: aborter.signal }));
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted || raw.creationKey !== pending.key || !['queued', 'running', 'success', 'partial', 'failed', 'cancelled', 'unavailable'].includes(String(raw.status))) throw new Error('Search acknowledgement is inconsistent');
      const id = carText(raw.id, 200, 'search identity');
      try { sessionStorage.removeItem(storageKey); } catch { /* The durable receipt still makes recovery safe. */ }
      update({ ...initial, phase: 'created', id });
    } catch (error) {
      if (sequence !== generation.current) return;
      if (searchId !== undefined && error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) {
        update({ ...initial, phase: 'uncertain', pending }); accessLost.current?.(); return;
      }
      const rejected = !aborter.signal.aborted && error instanceof TravelResponseError && error.definitive && [400, 401, 403, 404, 409, 410, 413, 415, 429].includes(error.status);
      if (searchId !== undefined && rejected && error.status === 410) { update({ ...initial, phase: 'removed', pending, error: error.message }); return; }
      if (!rejected || (recovering && error.status !== 410)) { update({ ...initial, phase: 'uncertain', pending, error: rejected ? error.message : '' }); return; }
      try { sessionStorage.removeItem(storageKey); }
      catch { update({ ...initial, phase: 'storage_error', pending }); return; }
      update({ ...initial, phase: error.status === 410 ? 'removed' : 'ready', error: error.message });
    } finally { clearTimeout(timer); if (controller.current === aborter) controller.current = null; }
  }
  async function create(body: Record<string, unknown>) {
    if (closed.current || !(searchId === undefined ? ['ready', 'removed'] : ['ready']).includes(current.current.phase)) return;
    await send({ key: crypto.randomUUID(), body: searchId === undefined ? body : carProtectionInput(body) }, false);
  }
  async function retry() {
    if (current.current.phase !== 'uncertain' || !current.current.pending) return;
    await send(current.current.pending, true);
  }
  function recoverStorage() {
    if (current.current.phase !== 'storage_error') return;
    try {
      // A known pending identity wins over unreadable storage; never mint another key.
      const pending = current.current.pending;
      if (pending) {
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
        update({ ...initial, phase: 'uncertain', pending }); return;
      }
      const restored = restore(sessionStorage.getItem(storageKey), searchId !== undefined);
      update({ ...initial, phase: restored ? 'uncertain' : closed.current ? 'closed' : 'ready', pending: restored });
    } catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  function discardUnreadable() {
    if (searchId !== undefined || current.current.phase !== 'storage_error' || current.current.pending) return;
    try { sessionStorage.removeItem(storageKey); update({ ...initial, phase: 'ready' }); }
    catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  async function closeTracking() {
    if (searchId === undefined || current.current.pending || !['storage_error', 'close_uncertain'].includes(current.current.phase)) return;
    const sequence = ++generation.current, aborter = new AbortController(); controller.current?.abort(); controller.current = aborter;
    update({ ...initial, phase: 'closing' });
    const timer = setTimeout(() => {
      if (sequence !== generation.current) return;
      generation.current++; aborter.abort(); update({ ...initial, phase: 'close_uncertain' });
    }, CAR_SEARCH_CREATION_TIMEOUT_MS);
    try {
      const raw = carRecord(await travelRequest<unknown>(`/api/cars/search/${encodeURIComponent(searchId)}/close-tracking`, { method: 'POST', signal: aborter.signal }));
      if (sequence !== generation.current) return;
      aborter.signal.throwIfAborted();
      if (raw.id !== searchId || raw.trackingClosed !== true) throw new Error('Search closure is not confirmed');
      closed.current = true;
      try { sessionStorage.removeItem(storageKey); } catch { /* The server closure remains authoritative. */ }
      update({ ...initial, phase: 'closed' });
    } catch (error) {
      if (sequence !== generation.current) return;
      update({ ...initial, phase: 'close_uncertain' });
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) accessLost.current?.();
    } finally { clearTimeout(timer); if (controller.current === aborter) controller.current = null; }
  }
  return { ...state, create, retry, recoverStorage, discardUnreadable, closeTracking,
    locked: closed.current || !(searchId === undefined ? ['ready', 'removed'] : ['ready']).includes(state.phase),
    isLocked: () => closed.current || !(searchId === undefined ? ['ready', 'removed'] : ['ready']).includes(current.current.phase) };
}
