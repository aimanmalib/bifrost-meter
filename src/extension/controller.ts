// Fetch, track, decide, render. No VS Code import: the extension passes in storage, rendering and notifications, so the
// whole refresh cycle runs in unit tests with a fake clock and a fake gateway.

import { fetchQuota, normalize, scrubKey, type QuotaRequest, type QuotaResult } from '../core';
import { trackForecasts, type SeriesStore } from './forecasts';
import { decideNotes, type Note, type NoteStore } from './notifications';
import type { Settings } from './settings';
import type { MeterState, Reading } from './state';

export interface Store {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface MeterDeps {
  settings(): Settings;
  /** Resolved base URL (setting, then environment). */
  baseUrl(): string;
  key(): Promise<string | undefined>;
  store: Store;
  now(): number;
  render(state: MeterState, key: string | undefined): void;
  notify(note: Note): void;
  log(line: string): void;
  fetch?: (req: QuotaRequest) => Promise<QuotaResult>;
}

export const STORE_SERIES = 'bifrostMeter.series';
export const STORE_NOTES = 'bifrostMeter.notes';

export class Meter {
  private current: MeterState = { kind: 'loading' };
  private lastReading: Reading | undefined;
  private lastKey: string | undefined;

  constructor(private readonly deps: MeterDeps) {}

  get state(): MeterState {
    return this.current;
  }

  get key(): string | undefined {
    return this.lastKey;
  }

  /** Forgets samples and notification state (the key changed, so the old numbers belong to another key). */
  async reset(): Promise<void> {
    this.lastReading = undefined;
    await this.deps.store.update(STORE_SERIES, {});
    await this.deps.store.update(STORE_NOTES, {});
  }

  showLoading(): void {
    this.set({ kind: 'loading' });
  }

  /** One refresh. Returns true when the gateway answered with usable numbers (the poller backs off otherwise). */
  async refresh(): Promise<boolean> {
    const d = this.deps;
    const s = d.settings();
    const key = await d.key();
    this.lastKey = key;
    if (!key) {
      this.set({ kind: 'unconfigured' });
      return true;
    }
    const result = await (d.fetch ?? fetchQuota)({ baseUrl: d.baseUrl(), key, allowInsecureHttp: s.allowInsecureHttp });
    const now = d.now();
    if (result.kind === 'noKey') {
      this.set({ kind: 'unconfigured' });
      return true;
    }
    if (result.kind !== 'ok') {
      d.log(scrubKey(`quota: ${describe(result)}`, key));
      this.set({ kind: 'error', result, at: now, ...(this.lastReading ? { last: this.lastReading } : {}) });
      return false;
    }
    const snapshot = normalize(result.quota, now);
    const tracked = trackForecasts(d.store.get<SeriesStore>(STORE_SERIES) ?? {}, snapshot.limits, now, s.forecastWindowMinutes);
    await d.store.update(STORE_SERIES, tracked.store);
    const decided = decideNotes(snapshot.limits, tracked.forecasts, s, d.store.get<NoteStore>(STORE_NOTES) ?? {});
    await d.store.update(STORE_NOTES, decided.store);
    this.lastReading = { snapshot, forecasts: tracked.forecasts, at: now };
    d.log(`quota: ok, ${snapshot.limits.length} limit(s)`);
    this.set({ kind: 'ready', ...this.lastReading });
    if (snapshot.isActive) for (const n of decided.notes) d.notify(n);
    return true;
  }

  /** Re-render with the same data (language or format setting changed). */
  rerender(): void {
    this.deps.render(this.current, this.lastKey);
  }

  private set(state: MeterState): void {
    this.current = state;
    this.deps.render(state, this.lastKey);
  }
}

/** A log line for a failed fetch. Never includes the key; server messages are scrubbed by the caller. */
export function describe(r: Exclude<QuotaResult, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'unauthorized':
    case 'http':
      return `HTTP ${r.status}${r.message ? ` (${r.message})` : ''}`;
    case 'forbidden':
      return `HTTP 403${r.expired ? ' expired' : ''}${r.message ? ` (${r.message})` : ''}`;
    case 'notFound':
      return 'HTTP 404 (endpoint missing: gateway older than the quota API?)';
    case 'schema':
      return `unexpected response: missing or invalid field "${r.field}"`;
    case 'timeout':
      return 'timed out';
    case 'offline':
      return `offline (${r.reason})`;
    case 'redirect':
      return `redirect to another host refused (${r.to})`;
    case 'insecure':
      return `plain http to public host refused (${r.host}); set allowInsecureHttp to override`;
    case 'invalidUrl':
      return 'invalid gateway URL';
    case 'noKey':
      return 'no key';
  }
}
