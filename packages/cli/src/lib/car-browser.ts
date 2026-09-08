import { CarClient, CarScopeError } from './car-client.js';
import { stripVTControlCharacters } from 'node:util';
import { readCarTrackerPage } from './car-views.js';
import { TravelResponseError } from '../../../../apps/web/src/components/travel/client.js';
import { validateCarDetailView, type CarDetailView } from '../../../../apps/web/src/lib/cars/detail-view.js';
import type { CarTrackerView } from '../../../../apps/web/src/lib/cars/tracker-view.js';
import { carReceiptDirectory } from './car-cli-input.js';
import { readCarReceipt, type CarOperation, type CarReceipt } from './car-receipts.js';
import { CarMutationError, performCarMutation, replayCarMutation } from './car-operations.js';
import { dirname, resolve } from 'node:path';
import { carProviderLocationLabels } from '../../../../apps/web/src/lib/cars/location-labels.js';
import { CAR_PROVIDER_LABELS } from '../../../../apps/web/src/lib/cars/preferences.js';

export interface CarBrowserConfirmation {
  operation: CarOperation;
  scope: string;
  origin: string;
  label: string;
  receiptPath: string | null;
  receipt: CarReceipt | null;
  conflict: boolean;
  locations?: string[];
}
export interface CarBrowserRecovery {
  path: string;
  outcome: CarMutationError['outcome'] | 'prepared' | 'confirmed';
  operation: CarOperation | null;
  scope: string | null;
}

export interface CarBrowserState {
  trackers: CarTrackerView[];
  detail: CarDetailView | null;
  scope: string | null;
  busy: boolean;
  hidden: boolean;
  error: string | null;
  page: number;
  nextCursor: string | null;
  confirmation: CarBrowserConfirmation | null;
  recoveries: CarBrowserRecovery[];
  mutationBusy: boolean;
  notice: string | null;
}

/** Remove terminal commands and invisible direction controls from remote text. */
export function carTerminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
}

/** Every published read is authenticated both before and after fetching its data. */
export class CarBrowser {
  private state: CarBrowserState = { trackers: [], detail: null, scope: null, busy: false, hidden: false, error: null, page: 0, nextCursor: null,
    confirmation: null, recoveries: [], mutationBusy: false, notice: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private positions: (string | null)[] = [null];
  private closed = false;
  private mutationController: AbortController | null = null;
  private mutation: Promise<void> | null = null;
  private receiptListeners = new Set<(path: string) => void>();
  private paths = new Set<string>();
  private recoveryRecords = new Map<string, CarBrowserRecovery>();

  constructor(private readonly client: CarClient, private readonly admin = false, private readonly receiptDirectory?: string) {}
  getSnapshot = (): CarBrowserState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeReceipts = (listener: (path: string) => void) => { this.receiptListeners.add(listener); return () => { this.receiptListeners.delete(listener); }; };
  getReceiptPaths = () => [...this.paths];
  async settle() { await this.mutation; }

  private publish(patch: Partial<CarBrowserState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async read<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => Partial<CarBrowserState>) {
    if (this.closed || this.state.mutationBusy) return;
    this.controller?.abort();
    const controller = new AbortController(), generation = ++this.generation;
    this.controller = controller;
    this.publish({ busy: true, error: null, confirmation: null });
    try {
      const before = await this.client.getSession(controller.signal);
      if (this.state.scope !== null && this.state.scope !== before.scope) throw new CarScopeError();
      const value = await load(controller.signal);
      const after = await this.client.getSession(controller.signal);
      if (before.scope !== after.scope) throw new CarScopeError();
      if (generation !== this.generation || controller.signal.aborted) return;
      this.publish({ ...apply(value), scope: before.scope, hidden: false, busy: false,
        recoveries: [...this.recoveryRecords.values()].map(row => row.scope === before.scope ? row : { ...row, operation: null, scope: null }) });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const inaccessible = error instanceof CarScopeError || error instanceof TravelResponseError && [401, 403, 404].includes(error.status);
      if (inaccessible) {
        this.loseAccess();
        return;
      }
      this.publish({ busy: false, error: carTerminalText(error instanceof Error ? error.message : String(error)) });
    }
  }

  async reload() {
    const id = this.state.detail?.tracker.id;
    if (id) return this.open(id);
    return this.loadPage(this.state.page);
  }

  private async loadPage(index: number) {
    const position = this.positions[index];
    if (position === undefined) return;
    await this.read(signal => readCarTrackerPage(this.client, position, this.admin, signal), value => ({ ...value, detail: null, page: index }));
  }

  async nextPage() {
    if (this.state.busy || !this.state.nextCursor || this.state.detail) return;
    this.positions[this.state.page + 1] = this.state.nextCursor;
    await this.loadPage(this.state.page + 1);
  }

  async previousPage() {
    if (this.state.busy || this.state.page === 0 || this.state.detail) return;
    await this.loadPage(this.state.page - 1);
  }

  async open(id: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !this.state.trackers.some(row => row.id === id)) return;
    await this.read(async signal => validateCarDetailView(await this.client.request(`/api/cars/${id}`, { signal }), id), detail => ({ detail }));
  }

  async back() { await this.loadPage(this.state.page); }

  private loseAccess() {
    ++this.generation;
    this.controller?.abort(); this.mutationController?.abort(); this.positions = [null];
    this.publish({ trackers: [], detail: null, scope: null, hidden: true, busy: false, page: 0, nextCursor: null,
      confirmation: null, notice: null, recoveries: this.state.recoveries.map(row => ({ ...row, operation: null, scope: null })),
      error: 'Account access changed. Private data is hidden. Restore access and reload. Recovery files are retained.' });
  }

  cancelConfirmation() { if (!this.state.mutationBusy) this.publish({ confirmation: null }); }

  requestAction(action: 'pause' | 'resume' | 'refresh' | 'delete') {
    const { detail, scope, hidden, busy, mutationBusy } = this.state;
    if (this.closed || hidden || busy || mutationBusy || !detail || !scope) return;
    const tracker = detail.tracker;
    const operation: CarOperation = { kind: action === 'pause' || action === 'resume' ? 'edit' : action,
      id: tracker.id, revision: tracker.revision, body: action === 'pause' || action === 'resume' ? { active: action === 'resume' } : null };
    const prior = this.state.recoveries.filter(row => row.scope === scope && row.operation?.id === tracker.id);
    const blocked = prior.some(row => {
      if (row.outcome === 'stale') return row.operation?.revision === tracker.revision;
      if (!['prepared', 'unconfirmed', 'inaccessible'].includes(row.outcome)) return false;
      return row.operation?.kind !== 'refresh' || operation.kind === 'refresh';
    });
    if (blocked) { this.publish({ error: 'Recover the earlier request before starting a conflicting change. Use its saved receipt.', confirmation: null }); return; }
    this.publish({ error: null, confirmation: { operation, scope, origin: this.client.origin, label: tracker.label,
      locations: (['pickup', 'dropoff'] as const).flatMap(stop => carProviderLocationLabels(tracker.search[stop], tracker.selection ? [tracker.selection.source] : tracker.search.sources)
        .map(({ source, name }) => `${stop === 'pickup' ? 'Pickup' : 'Return'} search location (${CAR_PROVIDER_LABELS[source]}): ${name}`)),
      receiptPath: null, receipt: null, conflict: prior.some(row => row.outcome === 'stale') } });
  }

  async reviewReceipt(path: string) {
    if (!this.state.scope || this.state.hidden || this.state.mutationBusy) return;
    const scope = this.state.scope;
    path = resolve(path);
    await this.read(async signal => {
      await carReceiptDirectory(dirname(path));
      return readCarReceipt(path, this.client, signal, scope);
    }, receipt => ({ confirmation: { operation: receipt.operation, scope: receipt.scope, origin: receipt.origin,
      label: 'Saved request', receiptPath: path, receipt, conflict: false } }));
  }

  confirm() {
    if (this.closed || this.state.busy || this.state.mutationBusy || !this.state.confirmation) return Promise.resolve();
    const confirmation = structuredClone(this.state.confirmation);
    if (confirmation.scope !== this.state.scope || this.state.hidden) { this.loseAccess(); return Promise.resolve(); }
    if (!confirmation.receiptPath && (this.state.detail?.tracker.id !== confirmation.operation.id || this.state.detail.tracker.revision !== confirmation.operation.revision)) {
      this.publish({ confirmation: null, error: 'Tracker changed. Reload and review the change again.' }); return Promise.resolve();
    }
    const controller = new AbortController(); this.mutationController = controller;
    this.controller?.abort(); ++this.generation;
    this.publish({ confirmation: null, mutationBusy: true, error: null, notice: null });
    this.mutation = this.execute(confirmation, controller.signal);
    return this.mutation;
  }

  private remember(path: string, confirmation: CarBrowserConfirmation, outcome: CarBrowserRecovery['outcome']) {
    this.paths.add(path);
    const row = { path, outcome, operation: confirmation.operation, scope: confirmation.scope };
    this.recoveryRecords.set(path, row);
    if (this.closed) return;
    this.publish({ recoveries: [...this.state.recoveries.filter(entry => entry.path !== path), row] });
  }

  private async execute(confirmation: CarBrowserConfirmation, signal: AbortSignal) {
    try {
      const prepared = (path: string) => {
        this.remember(path, confirmation, 'prepared');
        for (const listener of this.receiptListeners) listener(path);
      };
      if (confirmation.receiptPath) prepared(confirmation.receiptPath);
      const result = confirmation.receiptPath
        ? await replayCarMutation(confirmation.receiptPath, this.client, signal, confirmation.receipt!)
        : await performCarMutation(await carReceiptDirectory(this.receiptDirectory), this.client, confirmation.operation, prepared, signal, confirmation.scope);
      this.remember(result.receiptPath, confirmation, 'confirmed');
      const session = await this.client.getSession(signal);
      if (session.scope !== confirmation.scope) throw new CarScopeError();
      if (this.closed || signal.aborted) return;
      this.publish({ mutationBusy: false, notice: 'Server acknowledged the request. Recovery receipt retained.' });
      if (confirmation.operation.kind === 'delete') {
        this.publish({ detail: null }); await this.loadPage(this.state.page);
      } else await this.reload();
    } catch (error) {
      if (error instanceof CarMutationError) this.remember(error.receiptPath, confirmation, error.outcome);
      if (this.closed) return;
      if (error instanceof CarScopeError || error instanceof CarMutationError && error.outcome === 'inaccessible'
        || error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) { this.loseAccess(); return; }
      this.publish({ error: carTerminalText(error instanceof Error ? error.message : String(error)) });
    } finally {
      if (!this.closed && this.mutationController?.signal === signal) this.publish({ mutationBusy: false });
    }
  }

  close() {
    this.closed = true;
    ++this.generation;
    this.controller?.abort();
    this.mutationController?.abort();
    this.publish({ trackers: [], detail: null, scope: null, busy: false, hidden: true, mutationBusy: false, confirmation: null,
      notice: null, error: null, recoveries: this.state.recoveries.map(row => ({ ...row, operation: null, scope: null })) });
  }
}
