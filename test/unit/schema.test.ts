import { describe, expect, it } from 'vitest';
import { errorMessage, parseQuota } from '../../src/core/schema';
import { body, fixture } from './fixtures';

describe('parseQuota on recorded fixtures', () => {
  it.each(['quota-200-fresh', 'quota-200-after-traffic', 'quota-200-no-limits', 'quota-200-inactive', 'quota-200-bearer-header'])(
    '%s is accepted',
    (name) => {
      const r = parseQuota(fixture(name).body);
      expect(r.ok).toBe(true);
    },
  );

  it('keeps the measured counters of the after-traffic fixture', () => {
    const r = parseQuota(fixture('quota-200-after-traffic').body);
    if (!r.ok) throw new Error(r.field);
    expect(r.value.budgets[0]?.current_usage).toBeGreaterThan(0);
    expect(r.value.rate_limit?.request_current_usage).toBeGreaterThan(0);
  });

  it('reads no-limit keys as empty, not zero', () => {
    const r = parseQuota(fixture('quota-200-no-limits').body);
    if (!r.ok) throw new Error(r.field);
    expect(r.value.budgets).toEqual([]);
    expect(r.value.rate_limit).toBeNull();
    expect(r.value.rate_limits).toEqual([]);
  });
});

describe('parseQuota names the broken field', () => {
  const cases: [string, (b: Record<string, unknown>) => void, string][] = [
    ['body not an object', () => undefined, '(body)'],
    ['missing virtual_key_name', (b) => delete b.virtual_key_name, 'virtual_key_name'],
    ['is_active as string', (b) => (b.is_active = 'yes'), 'is_active'],
    ['missing budgets', (b) => delete b.budgets, 'budgets'],
    ['budget without max_limit', (b) => delete (b.budgets as Record<string, unknown>[])[0]!.max_limit, 'budgets[0].max_limit'],
    ['budget usage as string', (b) => ((b.budgets as Record<string, unknown>[])[0]!.current_usage = '1'), 'budgets[0].current_usage'],
    ['rate_limit as number', (b) => (b.rate_limit = 5), 'rate_limit'],
    ['rate_limit count as string', (b) => ((b.rate_limit as Record<string, unknown>).token_max_limit = 'x'), 'rate_limit.token_max_limit'],
    ['rate_limits not a list', (b) => (b.rate_limits = {}), 'rate_limits'],
  ];
  it.each(cases)('%s', (_, mutate, field) => {
    const b = body('quota-200-after-traffic');
    mutate(b);
    const input = field === '(body)' ? 'not json object' : b;
    expect(parseQuota(input)).toEqual({ ok: false, field });
  });

  it('ignores unknown fields and skips malformed provider entries', () => {
    const b = body('quota-200-after-traffic');
    b.something_new = { nested: true };
    b.provider_configs = ['bad', { provider: 'openai', budgets: [{ max_limit: 'x' }] }, { provider: 'anthropic' }];
    const r = parseQuota(b);
    if (!r.ok) throw new Error(r.field);
    expect(r.value.provider_configs.map((p) => p.provider)).toEqual(['anthropic']);
  });
});

describe('errorMessage', () => {
  it('reads the message of recorded error bodies', () => {
    expect(errorMessage(fixture('quota-401-unknown-key').body)).toBe('Virtual key not found');
    expect(errorMessage(fixture('quota-403-expired').body)).toBe('Virtual key has expired');
    expect(errorMessage(fixture('quota-401-missing-key').body)).toMatch(/^Missing virtual key/);
  });
  it.each([undefined, null, 'text', { error: 'x' }, { error: { message: 1 } }])('returns undefined for %j', (v) => {
    expect(errorMessage(v)).toBeUndefined();
  });
});
