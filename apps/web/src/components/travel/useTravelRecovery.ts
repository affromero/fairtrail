'use client';
import { useEffect, useRef, useState } from 'react';
import { validateTravelAdmissionView, type TravelAdmissionView } from '@/lib/travel/admission-view';
import { travelRequest, TravelResponseError, TRAVEL_ACCESS_LOST_EVENT } from './client';

export const TRAVEL_RECOVERY_TIMEOUT_MS = 15_000;
type Phase = 'loading' | 'ready' | 'saving' | 'failed' | 'uncertain' | 'changed' | 'inaccessible';
interface State { data: TravelAdmissionView | null; phase: Phase; stopped: boolean; network: boolean; notice: 'reopened' | 'refreshed' | null }
const initial: State = { data: null, phase: 'loading', stopped: false, network: false, notice: null };

export function useTravelRecovery() {
  const [state, setState] = useState(initial), current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const update = (value: State) => { current.current = value; setState(value); };
  function hide() {
    generation.current++; controller.current?.abort(); update({ ...initial, phase: 'inaccessible' });
  }
  async function request(recover: boolean) {
    const prior = current.current;
    if (controller.current && ['loading', 'saving'].includes(prior.phase)) return;
    if (recover && (prior.phase !== 'ready' || !prior.data?.quarantinedAt || !prior.stopped || !prior.network)) return;
    const sequence = ++generation.current, aborter = new AbortController(); controller.current = aborter;
    update({ ...initial, data: prior.data, phase: recover ? 'saving' : 'loading' });
    const timer = setTimeout(() => {
      if (sequence !== generation.current) return;
      generation.current++; aborter.abort(); update({ ...initial, data: prior.data, phase: recover ? 'uncertain' : 'failed' });
    }, TRAVEL_RECOVERY_TIMEOUT_MS);
    try {
      const data = validateTravelAdmissionView(await travelRequest('/api/admin/travel', {
        method: recover ? 'POST' : 'GET', cache: 'no-store', signal: aborter.signal,
        ...(recover ? { body: JSON.stringify({ actorScope: prior.data!.actorScope, generation: prior.data!.recoveryGeneration, oldWorkersStopped: true, networkVerified: true }) } : {}),
      }, { maxResponseBytes: 16 * 1024 }));
      if (sequence !== generation.current) return;
      if (recover && data.actorScope !== prior.data!.actorScope) { hide(); return; }
      if (recover && (data.quarantinedAt !== null || data.recoveryGeneration !== prior.data!.recoveryGeneration + 1)) {
        update({ ...initial, data, phase: 'changed' }); return;
      }
      update({ ...initial, data, phase: 'ready', notice: recover ? 'reopened' : 'refreshed' });
    } catch (error) {
      if (sequence !== generation.current) return;
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) { hide(); return; }
      update({ ...initial, data: prior.data, phase: recover ? error instanceof TravelResponseError && error.status === 412 ? 'changed' : 'uncertain' : 'failed' });
    } finally { clearTimeout(timer); if (controller.current === aborter) controller.current = null; }
  }
  useEffect(() => {
    void request(false);
    window.addEventListener(TRAVEL_ACCESS_LOST_EVENT, hide);
    return () => { generation.current++; controller.current?.abort(); controller.current = null; window.removeEventListener(TRAVEL_ACCESS_LOST_EVENT, hide); };
  }, []);
  function confirm(field: 'stopped' | 'network', checked: boolean) {
    if (current.current.phase !== 'ready' || !current.current.data?.quarantinedAt) return;
    update({ ...current.current, [field]: checked });
  }
  return { ...state, reload: () => request(false), recover: () => request(true), confirm };
}
