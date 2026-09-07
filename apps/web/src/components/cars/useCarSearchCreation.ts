'use client';
import { useEffect, useRef, useState } from 'react';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { carRecord, carText } from '@/lib/cars/validation';
import { travelRequest, TravelResponseError } from '../travel/client';

interface Pending { key: string; body: Record<string, unknown> }
type Phase = 'loading' | 'ready' | 'sending' | 'uncertain' | 'storage_error' | 'created' | 'removed';
interface State { phase: Phase; pending: Pending | null; id: string | null; error: string }
const initial: State = { phase: 'loading', pending: null, id: null, error: '' };

export function useCarSearchCreation(actorScope: string) {
  const [state, setState] = useState<State>(initial), current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const storageKey = `ff-car-search:${encodeURIComponent(actorScope)}`;
  const update = (state: State) => { current.current = state; setState(state); };
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey), raw = saved === null ? null : carRecord(JSON.parse(saved));
      const pending = raw ? { key: validateCarCreationKey(raw.key), body: carRecord(raw.body) } : null;
      const next: State = { ...initial, pending, phase: pending ? 'uncertain' : 'ready' };
      current.current = next; setState(next);
    } catch { const next: State = { ...initial, phase: 'storage_error' }; current.current = next; setState(next); }
    return () => { generation.current++; controller.current?.abort(); };
  }, [storageKey]);
  async function send(pending: Pending, recovering: boolean) {
    const sequence = generation.current, aborter = new AbortController(); controller.current = aborter;
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
    catch { update({ ...initial, phase: 'storage_error', pending }); return; }
    update({ ...initial, phase: 'sending', pending });
    const timer = setTimeout(() => aborter.abort(), 15_000);
    try {
      const raw = carRecord(await travelRequest<unknown>('/api/cars/search', { method: 'POST', body: JSON.stringify(pending.body), headers: { 'Idempotency-Key': pending.key }, signal: aborter.signal }));
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted || raw.creationKey !== pending.key || !['queued', 'running', 'success', 'partial', 'failed', 'cancelled', 'unavailable'].includes(String(raw.status))) throw new Error('Search acknowledgement is inconsistent');
      const id = carText(raw.id, 200, 'search identity');
      try { sessionStorage.removeItem(storageKey); } catch { /* The durable receipt still makes recovery safe. */ }
      update({ ...initial, phase: 'created', id });
    } catch (error) {
      if (sequence !== generation.current) return;
      const rejected = !aborter.signal.aborted && error instanceof TravelResponseError && error.definitive && [400, 401, 403, 404, 409, 410, 413, 415, 429].includes(error.status);
      if (!rejected || (recovering && error.status !== 410)) { update({ ...initial, phase: 'uncertain', pending, error: rejected ? error.message : '' }); return; }
      try { sessionStorage.removeItem(storageKey); }
      catch { update({ ...initial, phase: 'storage_error', pending }); return; }
      update({ ...initial, phase: error.status === 410 ? 'removed' : 'ready', error: error.message });
    } finally { clearTimeout(timer); if (controller.current === aborter) controller.current = null; }
  }
  async function create(body: Record<string, unknown>) {
    if (!['ready', 'removed'].includes(current.current.phase)) return;
    await send({ key: crypto.randomUUID(), body }, false);
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
      const saved = sessionStorage.getItem(storageKey), raw = saved === null ? null : carRecord(JSON.parse(saved));
      const restored = raw ? { key: validateCarCreationKey(raw.key), body: carRecord(raw.body) } : null;
      update({ ...initial, phase: restored ? 'uncertain' : 'ready', pending: restored });
    } catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  function discardUnreadable() {
    if (current.current.phase !== 'storage_error' || current.current.pending) return;
    try { sessionStorage.removeItem(storageKey); update({ ...initial, phase: 'ready' }); }
    catch { update({ ...current.current, phase: 'storage_error' }); }
  }
  return { ...state, create, retry, recoverStorage, discardUnreadable, locked: !['ready', 'removed'].includes(state.phase) };
}
