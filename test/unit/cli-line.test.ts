import { describe, expect, it } from 'vitest';
import { statusLine } from '../../src/cli/line';
import { parseQuota, translator, type QuotaResult } from '../../src/core';
import { body } from './fixtures';

const en = translator('en');
const NOW = Date.parse('2026-11-14T14:00:00Z');

function reading(mutate?: (b: Record<string, unknown>) => void): QuotaResult {
  const b = body('quota-200-after-traffic');
  mutate?.(b);
  const r = parseQuota(b);
  if (!r.ok) throw new Error(r.field);
  return { kind: 'ok', quota: r.value } as QuotaResult;
}
const budget = (b: Record<string, unknown>): Record<string, unknown> => (b.budgets as Record<string, unknown>[])[0]!;

describe('statusLine', () => {
  it('shows the limit closest to running out, as the status bar does', () => {
    const line = statusLine(reading((b) => Object.assign(budget(b), { max_limit: 1, current_usage: 0.82, last_reset: '2026-11-14T13:00:00Z', reset_duration: '1d' })), NOW, en, 'en');
    expect(line).toEqual({ ok: true, text: 'Bifrost 82% · $0.18 left · resets in 23h' });
  });
  it('says when the limit is used up', () => {
    const line = statusLine(reading((b) => Object.assign(budget(b), { max_limit: 1, current_usage: 1, last_reset: '2026-11-14T13:00:00Z', reset_duration: '1d' })), NOW, en, 'en');
    expect(line.text).toBe('Bifrost Budget used up · resets in 23h');
  });
  it('names the provider or model when the closest limit is not the key\'s own', () => {
    const scoped = (b: Record<string, unknown>): void => {
      Object.assign(budget(b), { max_limit: 10, current_usage: 1 });
      b.provider_configs = [{ provider: 'openai', budgets: [{ max_limit: 1, current_usage: 0.6, last_reset: '2026-11-14T13:00:00Z', reset_duration: '1d' }] }];
    };
    expect(statusLine(reading(scoped), NOW, en, 'en').text).toBe('Bifrost 60% · $0.40 left · resets in 23h · openai');
    const model = (b: Record<string, unknown>): void => {
      Object.assign(budget(b), { max_limit: 10, current_usage: 1 });
      b.model_configs = [{ model_name: 'gpt-4o-mini', rate_limit: { request_max_limit: 10, request_current_usage: 10 } }];
    };
    expect(statusLine(reading(model), NOW, en, 'en').text).toMatch(/^Bifrost Requests used up( · resets in \S+)? · gpt-4o-mini$/);
    expect(statusLine(reading(model), NOW, translator('ms'), 'ms').text).toMatch(/^Bifrost Permintaan habis( · set semula dalam \S+)? · gpt-4o-mini$/);
  });
  it('says when the key has no limit', () => {
    expect(statusLine({ kind: 'ok', quota: parseQuotaOk('quota-200-no-limits') } as QuotaResult, NOW, en, 'en').text).toBe('Bifrost No limit');
  });
  it('reports a missing key and a rejected key without a number', () => {
    expect(statusLine({ kind: 'noKey' } as QuotaResult, NOW, en, 'en')).toEqual({ ok: false, text: 'Bifrost Set Bifrost key' });
    expect(statusLine({ kind: 'unauthorized', status: 401 } as QuotaResult, NOW, en, 'en')).toEqual({ ok: false, text: 'Bifrost Key rejected' });
  });
  it('speaks Malay when asked', () => {
    const ms = translator('ms');
    expect(statusLine({ kind: 'unauthorized', status: 401 } as QuotaResult, NOW, ms, 'ms').text).toMatch(/^Bifrost /);
  });
});

function parseQuotaOk(name: string) {
  const r = parseQuota(body(name));
  if (!r.ok) throw new Error(r.field);
  return r.value;
}
