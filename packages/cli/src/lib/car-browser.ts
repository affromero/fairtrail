import { CarClient, CarScopeError } from './car-client.js';
import { stripVTControlCharacters } from 'node:util';
import { readCarTrackerPage } from './car-views.js';
import { TravelResponseError } from '../../../../apps/web/src/components/travel/client.js';
import { validateCarDetailView, type CarDetailView } from '../../../../apps/web/src/lib/cars/detail-view.js';
import type { CarTrackerView } from '../../../../apps/web/src/lib/cars/tracker-view.js';

export interface CarBrowserState {
  trackers: CarTrackerView[];
  detail: CarDetailView | null;
  scope: string | null;
  busy: boolean;
  hidden: boolean;
  error: string | null;
  page: number;
  nextCursor: string | null;
}

/** Remove terminal commands and invisible direction controls from remote text. */
export function carTerminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
}

/** Every published read is authenticated both before and after fetching its data. */
export class CarBrowser {
  private state: CarBrowserState = { trackers: [], detail: null, scope: null, busy: false, hidden: false, error: null, page: 0, nextCursor: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private positions: (string | null)[] = [null];
  private closed = false;

  constructor(private readonly client: CarClient, private readonly admin = false) {}
  getSnapshot = (): CarBrowserState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(patch: Partial<CarBrowserState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async read<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => Partial<CarBrowserState>) {
    if (this.closed) return;
    this.controller?.abort();
    const controller = new AbortController(), generation = ++this.generation;
    this.controller = controller;
    this.publish({ busy: true, error: null });
    try {
      const before = await this.client.getSession(controller.signal);
      if (this.state.scope !== null && this.state.scope !== before.scope) throw new CarScopeError();
      const value = await load(controller.signal);
      const after = await this.client.getSession(controller.signal);
      if (before.scope !== after.scope) throw new CarScopeError();
      if (generation !== this.generation || controller.signal.aborted) return;
      this.publish({ ...apply(value), scope: before.scope, hidden: false, busy: false });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const inaccessible = error instanceof CarScopeError || error instanceof TravelResponseError && [401, 403, 404].includes(error.status);
      if (inaccessible) {
        this.positions = [null];
        this.publish({ trackers: [], detail: null, scope: null, hidden: true, busy: false, page: 0, nextCursor: null,
          error: 'Account access changed. Private data is hidden. Restore access and reload.' });
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

  close() {
    this.closed = true;
    ++this.generation;
    this.controller?.abort();
    this.publish({ trackers: [], detail: null, scope: null, busy: false, hidden: true });
  }
}
