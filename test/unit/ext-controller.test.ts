import { describe, expect, it } from 'vitest';
import { parseQuota, type QuotaRequest, type QuotaResult } from '../../src/core';
import { Meter, type MeterDeps } from '../../src/extension/controller';
import type { Note } from '../../src/extension/notifications';
import type { MeterState } from '../../src/extension/state';
import { NOW, settings } from './ext-helpers';
import { body } from './fixtures';

// Built at runtime so the test file holds nothing shaped like a real key.
const KEY = ['sk', 'bf', 'x'.repeat(16) + 'WXYZ'].join('-');

function ok(usage: number, isActive = true): QuotaResult {
  const b = body('quota-200-after-traffic') as { budgets: { current_usage: number }[]; is_active: boolean };
  b.budgets[0]!.current_usage = usage;
  b.is_active = isActive;
  const parsed = parseQuota(b);
  if (!parsed.ok) throw new Error(parsed.field);
  return { kind: 'ok', quota: parsed.value, status: 200 };
}

function setup(results: QuotaResult[], key: string | undefined = KEY) {
  const data = new Map<string, unknown>();
  const rendered: MeterState[] = [];
  const notes: Note[] = [];
  const logs: string[] = [];
  const requests: QuotaRequest[] = [];
  let now = NOW;
  let i = 0;
  const deps: MeterDeps = {
    settings: () => settings(),
    baseUrl: () => 'http://localhost:8080',
    key: async () => key,
    store: { get: <T>(k: string) => data.get(k) as T | undefined, update: async (k, v) => void data.set(k, v) },
    now: () => now,
    render: (s) => rendered.push(s),
    notify: (n) => notes.push(n),
    log: (l) => logs.push(l),
    fetch: async (req) => {
      requests.push(req);
      return results[Math.min(i++, results.length - 1)]!;
    },
  };
  return { meter: new Meter(deps), rendered, notes, logs, requests, data, tick: (ms: number) => (now += ms) };
}

describe('Meter', () => {
  it('shows "not configured" without calling the gateway when there is no key', async () => {
    const { meter, requests, rendered } = setup([ok(1)], '');
    expect(await meter.refresh()).toBe(true);
    expect(requests).toHaveLength(0);
    expect(rendered.at(-1)?.kind).toBe('unconfigured');
  });
  it('turns a gateway answer into a ready state with limits', async () => {
    const { meter, requests } = setup([ok(1)]);
    expect(await meter.refresh()).toBe(true);
    expect(requests[0]).toMatchObject({ baseUrl: 'http://localhost:8080', key: KEY, allowInsecureHttp: false });
    const s = meter.state;
    expect(s.kind).toBe('ready');
    if (s.kind === 'ready') expect(s.snapshot.limits.map((l) => l.kind)).toEqual(['budget', 'tokens', 'requests']);
  });
  it('keeps the last reading on error and reports failure to the poller', async () => {
    const { meter } = setup([ok(1), { kind: 'offline', reason: 'ECONNREFUSED' }]);
    await meter.refresh();
    expect(await meter.refresh()).toBe(false);
    const s = meter.state;
    expect(s.kind === 'error' && s.last?.snapshot.keyName).toBeTruthy();
  });
  it('never writes the key to the log, even when the server echoes it', async () => {
    const { meter, logs } = setup([{ kind: 'unauthorized', status: 401, message: `bad key ${KEY}` }]);
    await meter.refresh();
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).toContain('WXYZ');
  });
  it('notifies once when a threshold is crossed, across refreshes', async () => {
    const { meter, notes, tick } = setup([ok(1), ok(4), ok(4.1), ok(4.2)]);
    await meter.refresh();
    tick(60_000);
    await meter.refresh();
    tick(60_000);
    await meter.refresh();
    tick(60_000);
    await meter.refresh();
    expect(notes.filter((n) => n.kind === 'threshold').map((n) => n.kind === 'threshold' && n.level)).toEqual(['warn']);
  });
  it('forecasts from stored samples', async () => {
    const { meter, tick } = setup([ok(1), ok(1.5), ok(2)]);
    await meter.refresh();
    tick(5 * 60_000);
    await meter.refresh();
    tick(5 * 60_000);
    await meter.refresh();
    const s = meter.state;
    if (s.kind !== 'ready') throw new Error(s.kind);
    const budget = s.snapshot.limits.find((l) => l.kind === 'budget')!;
    expect(s.forecasts[budget.id]?.status).toBe('rising');
  });
  it('does not notify for an inactive key', async () => {
    const { meter, notes } = setup([ok(4.9, false)]);
    await meter.refresh();
    expect(notes).toEqual([]);
  });
  it('reset forgets samples and notification state', async () => {
    const { meter, data } = setup([ok(4)]);
    await meter.refresh();
    expect(Object.keys(data.get('bifrostMeter.series') as object).length).toBeGreaterThan(0);
    await meter.reset();
    expect(data.get('bifrostMeter.series')).toEqual({});
    expect(data.get('bifrostMeter.notes')).toEqual({});
  });
});
