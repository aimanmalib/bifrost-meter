import { describe, expect, it } from 'vitest';
import { parseQuota, translator, type QuotaResult } from '../../src/core';
import { readConfig } from '../../src/mcp/config';
import { budgetStatus } from '../../src/mcp/status';
import { body } from './fixtures';

const KEY = ['sk', 'bf', 'mcp0unit0value0wxyz9876'].join('-');
const NOW = Date.parse('2026-11-14T17:30:00Z');
const cfg = readConfig({ BIFROST_VIRTUAL_KEY: KEY, BIFROST_METER_LANGUAGE: 'en' });
const t = translator('en');

/** Sets a key-level rate-limit field in both places the gateway reports it. */
function setRate(b: Record<string, unknown>, field: string, value: unknown): void {
  (b.rate_limit as Record<string, unknown>)[field] = value;
  for (const r of b.rate_limits as Record<string, unknown>[]) r[field] = value;
}

function ok(b: Record<string, unknown>): QuotaResult {
  const parsed = parseQuota(b);
  if (!parsed.ok) throw new Error(`fixture shape: ${parsed.field}`);
  return { kind: 'ok', quota: parsed.value, status: 200 };
}

describe('readConfig', () => {
  it('uses the extension defaults and reads the documented variables', () => {
    const c = readConfig({});
    expect(c).toMatchObject({ baseUrl: 'http://localhost:8080', key: undefined, allowInsecureHttp: false, forecastWindowMinutes: 30, lang: 'en' });
    const d = readConfig({
      BIFROST_BASE_URL: ' https://gw.example.com ',
      BIFROST_VIRTUAL_KEY: ` ${KEY} `,
      BIFROST_ALLOW_INSECURE_HTTP: 'true',
      BIFROST_METER_FORECAST_WINDOW_MINUTES: '1',
      LANG: 'ms_MY.UTF-8',
    });
    expect(d).toMatchObject({ baseUrl: 'https://gw.example.com', key: KEY, allowInsecureHttp: true, forecastWindowMinutes: 5, lang: 'ms' });
    expect(readConfig({ BIFROST_METER_LANGUAGE: 'en', LANG: 'ms_MY' }).lang).toBe('en');
  });
});

describe('budgetStatus', () => {
  it('reports calendar_aligned from gateways that send it and null from v2.5.1', () => {
    const recorded = budgetStatus(ok(body('quota-200-after-traffic')), cfg, NOW, {}, t);
    const upstream = budgetStatus(ok(body('quota-200-upstream-next-reset')), cfg, Date.parse('2026-11-17T10:15:00Z'), {}, t);
    if (!recorded.ok || !upstream.ok) throw new Error('expected ok');
    expect(recorded.status.calendar_aligned).toBeNull();
    expect(upstream.status.calendar_aligned).toBe(true);
    expect(upstream.status.limits.find((l) => l.kind === 'tokens')?.resets_at).toBe('2026-11-17T11:00:00.000Z');
  });

  it('reports every limit with unit, remaining, percent and reset time from a recorded response', () => {
    const out = budgetStatus(ok(body('quota-200-after-traffic')), cfg, NOW, {}, t);
    if (!out.ok) throw new Error('expected ok');
    const s = out.status;
    expect(s).toMatchObject({ read_at: '2026-11-14T17:30:00.000Z', gateway: 'http://localhost:8080', is_active: true, is_exhausted: false });
    expect(s.key_hint).toBe('…9876');
    expect(s.limits.map((l) => l.unit).sort()).toEqual(['requests', 'tokens', 'usd']);
    const tokens = s.limits.find((l) => l.kind === 'tokens');
    expect(tokens).toMatchObject({ limit: 100000, used: 1200, remaining: 98800, percent: 1.2, is_exhausted: false, scope: 'key' });
    for (const l of s.limits) {
      expect(l.forecast).toBe('insufficient_data');
      expect(l.will_exhaust_before_reset).toBeNull();
      if (l.resets_at !== null) expect(Date.parse(l.resets_at)).toBeGreaterThan(NOW);
    }
    expect(s.will_exhaust_before_reset).toBeNull();
    expect(out.text).toContain('Tokens: 1.2k of 100k used (1%), 98.8k tokens left, resets in 50m.');
    expect(out.text).toContain('No forecast yet');
  });

  it('forecasts a run-out before the reset from readings kept between calls', () => {
    const b = body('quota-200-after-traffic');
    const first = budgetStatus(ok(b), cfg, NOW, {}, t);
    setRate(b, 'request_current_usage', 150);
    const second = budgetStatus(ok(b), cfg, NOW + 5 * 60_000, first.store, t);
    if (!second.ok) throw new Error('expected ok');
    const req = second.status.limits.find((l) => l.kind === 'requests');
    expect(req?.forecast).toBe('rising');
    expect(req?.will_exhaust_before_reset).toBe(true);
    expect(req?.exhausts_at).toMatch(/^2026-11-14T17:3\d:/);
    expect(second.status.will_exhaust_before_reset).toBe(true);
    expect(second.text).toMatch(/Requests runs out around 2026-11-14T17:3\d:.* before it resets\./);
  });

  it('says false once every open limit is steady', () => {
    const b = body('quota-200-after-traffic');
    const first = budgetStatus(ok(b), cfg, NOW, {}, t);
    const second = budgetStatus(ok(b), cfg, NOW + 5 * 60_000, first.store, t);
    if (!second.ok) throw new Error('expected ok');
    expect(second.status.limits.every((l) => l.forecast === 'steady' && l.will_exhaust_before_reset === false)).toBe(true);
    expect(second.status.will_exhaust_before_reset).toBe(false);
    expect(second.text).not.toContain('No forecast yet');
  });

  it('marks a used-up limit as exhausted and leaves its forecast out of the overall answer', () => {
    const b = body('quota-200-after-traffic');
    setRate(b, 'request_current_usage', 200);
    const out = budgetStatus(ok(b), cfg, NOW, {}, t);
    if (!out.ok) throw new Error('expected ok');
    const req = out.status.limits.find((l) => l.kind === 'requests');
    expect(req).toMatchObject({ is_exhausted: true, remaining: 0, forecast: 'exhausted', will_exhaust_before_reset: null });
    expect(out.status.is_exhausted).toBe(true);
    expect(out.text).toContain('Requests is used up');
  });

  it('reports a key with no limits and an inactive key as facts', () => {
    const none = budgetStatus(ok(body('quota-200-no-limits')), cfg, NOW, {}, t);
    if (!none.ok) throw new Error('expected ok');
    expect(none.status.limits).toEqual([]);
    expect(none.status.will_exhaust_before_reset).toBe(false);
    expect(none.text).toContain('This key has no budget or rate limit.');
    const inactive = budgetStatus(ok(body('quota-200-inactive')), cfg, NOW, {}, t);
    if (!inactive.ok) throw new Error('expected ok');
    expect(inactive.status.is_active).toBe(false);
    expect(inactive.text).toContain('inactive');
  });

  it.each<[QuotaResult, string, number | null, RegExp]>([
    [{ kind: 'noKey' }, 'noKey', null, /BIFROST_VIRTUAL_KEY is not set/],
    [{ kind: 'unauthorized', status: 401 }, 'unauthorized', 401, /Key rejected/],
    [{ kind: 'forbidden', status: 403, expired: true }, 'forbidden', 403, /Key expired/],
    [{ kind: 'forbidden', status: 403, expired: false }, 'forbidden', 403, /Key refused/],
    [{ kind: 'notFound', status: 404 }, 'notFound', 404, /Gateway too old/],
    [{ kind: 'http', status: 502 }, 'http', 502, /HTTP 502/],
    [{ kind: 'schema', field: 'budgets' }, 'schema', null, /field budgets/],
    [{ kind: 'offline', reason: 'ECONNREFUSED' }, 'offline', null, /Gateway offline/],
    [{ kind: 'timeout' }, 'timeout', null, /Gateway offline/],
    [{ kind: 'insecure', host: 'gw.example.com' }, 'insecure', null, /BIFROST_ALLOW_INSECURE_HTTP=1/],
    [{ kind: 'redirect', to: 'https://other.example.com' }, 'redirect', null, /other\.example\.com/],
    [{ kind: 'invalidUrl' }, 'invalidUrl', null, /Invalid URL/],
  ])('turns %o into a named error', (result, kind, status, text) => {
    const out = budgetStatus(result, cfg, NOW, {}, t);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatchObject({ kind, status });
    expect(out.text).toMatch(/^Could not read the quota\. /);
    expect(out.text).toMatch(text);
    expect(out.text).not.toMatch(/\{\d\}|^mcp\./);
  });

  it('never puts the key in the result and speaks Malay when asked', () => {
    const ms = readConfig({ BIFROST_VIRTUAL_KEY: KEY, BIFROST_METER_LANGUAGE: 'ms' });
    const out = budgetStatus(ok(body('quota-200-after-traffic')), ms, NOW, {}, translator('ms'));
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.text).toContain('dibaca pada');
    expect(out.text).not.toMatch(/\{\d\}|mcp\.text/);
  });
});
