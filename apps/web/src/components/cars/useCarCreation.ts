'use client';
import { useEffect, useRef, useState } from 'react';
import { carCreationInput, validateCarCreationKey } from '@/lib/cars/creation-input';
import { carRecord, carText } from '@/lib/cars/validation';
import type { CarTrackingOptions } from '@/lib/cars/types';
import { travelRequest, TravelResponseError } from '../travel/client';

interface CreationBody extends CarTrackingOptions { searchId: string; offerId: string; label?: string }
interface PendingCreation { key: string; body: CreationBody }
type Phase = 'loading' | 'ready' | 'sending' | 'uncertain' | 'rejected' | 'created' | 'storage_error' | 'removed' | 'closing' | 'close_uncertain' | 'closed';
interface CreationState { phase: Phase; pending: PendingCreation | null; error: string; trackerId: string | null }
const initial: CreationState = { phase: 'loading', pending: null, error: '', trackerId: null };
export const CAR_CREATION_TIMEOUT_MS = 15_000;

function bodyFrom(raw: unknown): CreationBody {
  const { searchId, offerId, label, options } = carCreationInput(raw);
  return { searchId, offerId, ...options, ...(label === null ? {} : { label }) };
}
function restore(raw: string, searchId: string): PendingCreation {
  const value = carRecord(JSON.parse(raw)), key = validateCarCreationKey(value.key), body = bodyFrom(value.body);
  if (body.searchId !== searchId) throw new Error('Saved creation belongs to another search');
  return { key, body };
}

/** Persist before sending; aborting a request never implies that creation was undone. */
export function useCarCreation(actorScope: string, searchId: string, onAccessLost?: () => void, trackingClosed = false) {
  const storageKey = `ff-car-creation:${encodeURIComponent(actorScope)}:${encodeURIComponent(searchId)}`;
  const [state, setState] = useState<CreationState>(initial);
  const current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost;
  const closed = useRef(trackingClosed), serverClosed = useRef(trackingClosed); serverClosed.current = trackingClosed;
  const update = (next: CreationState) => { current.current = next; setState(next); };
  useEffect(() => {
    generation.current++;
    closed.current = serverClosed.current;
    try {
      const saved = sessionStorage.getItem(storageKey), pending = saved === null ? null : restore(saved, searchId);
      const next: CreationState = { ...initial, phase: pending ? 'uncertain' : closed.current ? 'closed' : 'ready', pending };
      current.current = next; setState(next);
    } catch {
      const next: CreationState = { ...initial, phase: closed.current ? 'closed' : 'storage_error' };
      current.current = next; setState(next);
    }
    return () => { generation.current++; controller.current?.abort(); controller.current = null; };
  }, [storageKey, searchId]);
  useEffect(() => {
    if (!trackingClosed) return;
    closed.current = true;
    if (!current.current.pending && !['created', 'closing'].includes(current.current.phase)) {
      const next: CreationState = { ...initial, phase: 'closed' };
      current.current = next; setState(next);
    }
  }, [trackingClosed]);

  async function send(pending: PendingCreation, recovering = false) {
    const active = generation.current, aborter = new AbortController();
    controller.current = aborter;
    update({ ...initial, phase: 'sending', pending });
    const timeout = setTimeout(() => {
      if (active !== generation.current) return;
      generation.current++;
      aborter.abort();
      update({ ...initial, phase: 'uncertain', pending });
    }, CAR_CREATION_TIMEOUT_MS);
    try {
      // A storage failure must prevent a mutation whose retry identity could be lost.
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    } catch {
      clearTimeout(timeout); controller.current = null;
      update({ ...initial, phase: 'storage_error', pending }); return;
    }
    try {
      const raw = await travelRequest<unknown>('/api/cars', { method: 'POST', body: JSON.stringify(pending.body), headers: { 'Idempotency-Key': pending.key }, signal: aborter.signal });
      if (aborter.signal.aborted) throw new Error('Creation acknowledgement arrived after cancellation');
      const result = carRecord(raw), tracker = carRecord(result.tracker);
      if (result.creationKey !== pending.key) throw new Error('Creation acknowledgement does not match this request');
      const trackerId = carText(tracker.id, 200, 'tracker identity');
      if (active !== generation.current) return;
      // A failed removal leaves the same safe retry receipt available on remount.
      try { sessionStorage.removeItem(storageKey); } catch { /* Acknowledged creation is still successful. */ }
      update({ ...initial, phase: 'created', trackerId });
    } catch (error) {
      if (active !== generation.current) return;
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) {
        update({ ...initial, phase: 'uncertain', pending, error: error.definitive ? error.message : '' });
        accessLost.current?.(); return;
      }
      const rejected = !aborter.signal.aborted && error instanceof TravelResponseError && error.definitive && [400, 401, 403, 404, 409, 410, 413, 415, 429].includes(error.status);
      if (rejected && error.status === 410) {
        // Keep the receipt so a remount cannot silently create a replacement.
        update({ ...initial, phase: 'removed', pending, error: error.message }); return;
      }
      if (!rejected || recovering) { update({ ...initial, phase: 'uncertain', pending, error: rejected ? error.message : '' }); return; }
      try { sessionStorage.removeItem(storageKey); }
      catch { update({ ...initial, phase: 'storage_error', pending }); return; }
      update({ ...initial, phase: 'rejected', error: error.message });
    } finally {
      clearTimeout(timeout);
      if (controller.current === aborter) controller.current = null;
    }
  }
  async function create(offerId: string, options: CarTrackingOptions, label?: string) {
    if (closed.current || !['ready', 'rejected'].includes(current.current.phase)) return;
    let body: CreationBody;
    try { body = bodyFrom({ searchId, offerId, ...options, ...(label === undefined ? {} : { label }) }); }
    catch (error) { update({ ...initial, phase: 'rejected', error: error instanceof Error ? error.message : 'Invalid rental settings' }); return; }
    await send({ key: crypto.randomUUID(), body });
  }
  async function retry() {
    if (current.current.phase !== 'uncertain' || !current.current.pending) return;
    await send(current.current.pending, true);
  }
  async function recoverStorage() {
    if (current.current.phase !== 'storage_error') return;
    if (current.current.pending) { await send(current.current.pending, true); return; }
    try {
      const saved = sessionStorage.getItem(storageKey);
      const pending = saved === null ? null : restore(saved, searchId);
      update({ ...initial, phase: pending ? 'uncertain' : closed.current ? 'closed' : 'ready', pending });
    } catch { update({ ...initial, phase: 'storage_error' }); }
  }
  async function closeTracking() {
    if (current.current.pending || !['storage_error', 'close_uncertain'].includes(current.current.phase)) return;
    const active = ++generation.current, aborter = new AbortController();
    controller.current?.abort(); controller.current = aborter;
    update({ ...initial, phase: 'closing' });
    const timeout = setTimeout(() => {
      if (active !== generation.current) return;
      generation.current++; aborter.abort();
      update({ ...initial, phase: 'close_uncertain' });
    }, CAR_CREATION_TIMEOUT_MS);
    try {
      const result = carRecord(await travelRequest<unknown>(`/api/cars/search/${encodeURIComponent(searchId)}/close-tracking`, { method: 'POST', signal: aborter.signal }));
      if (active !== generation.current) return;
      aborter.signal.throwIfAborted();
      if (result.id !== searchId || result.trackingClosed !== true) throw new Error('Search closure is not confirmed');
      closed.current = true;
      try { sessionStorage.removeItem(storageKey); } catch { /* The permanent server fence remains authoritative. */ }
      update({ ...initial, phase: 'closed' });
    } catch (error) {
      if (active !== generation.current) return;
      update({ ...initial, phase: 'close_uncertain' });
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) accessLost.current?.();
    } finally {
      clearTimeout(timeout);
      if (controller.current === aborter) controller.current = null;
    }
  }
  return { ...state, create, retry, recoverStorage, closeTracking, locked: trackingClosed || closed.current || !['ready', 'rejected'].includes(state.phase) };
}
