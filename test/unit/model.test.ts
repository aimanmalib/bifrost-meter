import { describe, expect, it } from 'vitest';
import { levelOf, normalize, strictest, type Limit } from '../../src/core/model';
import { parseQuota, type QuotaResponse } from '../../src/core/schema';
import { body, fixture } from './fixtures';

const NOW = Date.parse('2026-11-14T14:00:00Z');

function quota(name: string, mutate?: (b: Record<string, unknown>) => void): QuotaResponse {
  const b = body(name);
  mutate?.(b);
  const r = parseQuota(b);
  if (!r.ok) throw new Error(r.field);
  return r.value;
}

describe('normalize', () => {
  it('flattens the after-traffic fixture into budget, token and request limits', () => {
    const raw = fixture('quota-200-after-traffic').body as { budgets: { max_limit: number; current_usage: number }[] };
    const s = normalize(quota('quota-200-after-traffic'), NOW);
    expect(s.isActive).toBe(true);
    expect(s.limits.map((l) => [l.kind, l.scope])).toEqual([
      ['budget', 'key'],
      ['tokens', 'key'],
      ['requests', 'key'],
    ]);
    const b = s.limits[0]!;
    expect(b.limit).toBe(raw.budgets[0]!.max_limit);
    expect(b.used).toBe(raw.budgets[0]!.current_usage);
    expect(b.remaining).toBeCloseTo(b.limit - b.used, 10);
    expect(b.percent).toBeCloseTo((b.used / b.limit) * 100, 10);
    expect(b.resetRaw).toBe('1d');
    expect(b.nextReset).toBeGreaterThan(NOW);
  });

  it('de-duplicates rate_limit and rate_limits by id', () => {
    const s = normalize(quota('quota-200-after-traffic'), NOW);
    expect(s.limits.filter((l) => l.kind === 'tokens')).toHaveLength(1);
  });

  it('uses rate_limit when rate_limits is absent', () => {
    const s = normalize(quota('quota-200-after-traffic', (b) => delete b.rate_limits), NOW);
    expect(s.limits.filter((l) => l.kind !== 'budget')).toHaveLength(2);
  });

  it('gives no limits for a key without budget or rate limit', () => {
    expect(normalize(quota('quota-200-no-limits'), NOW).limits).toEqual([]);
  });

  it('reports an inactive key', () => {
    expect(normalize(quota('quota-200-inactive'), NOW).isActive).toBe(false);
  });

  it('reads a quarterly budget with the fiscal quarter start the gateway sends', () => {
    const s = normalize(
      quota('quota-200-after-traffic', (b) => {
        const budget = (b.budgets as Record<string, unknown>[])[0]!;
        budget.reset_duration = '1Q';
        budget.last_reset = '2026-11-01T00:00:00Z';
        budget.reset_config = { quarter_start_month: 2 };
      }),
      NOW,
    );
    expect(s.limits[0]).toMatchObject({ resetRaw: '1Q', nextReset: Date.parse('2027-02-01T00:00:00Z') });
  });

  it('keeps an unreadable reset period as raw text without a countdown', () => {
    const s = normalize(
      quota('quota-200-after-traffic', (b) => ((b.budgets as Record<string, unknown>[])[0]!.reset_duration = 'monthly-ish')),
      NOW,
    );
    expect(s.limits[0]).toMatchObject({ resetRaw: 'monthly-ish', nextReset: null });
  });

  it('labels provider and model scopes and sums spend per model', () => {
    const s = normalize(
      quota('quota-200-after-traffic', (b) => {
        b.provider_configs = [{ provider: 'openai', budgets: [{ max_limit: 2, current_usage: 1 }], rate_limit: null }];
        b.model_configs = [{ model_name: 'gpt-4o-mini', rate_limit: { request_max_limit: 10, request_current_usage: 9 } }];
        (b.budgets as Record<string, unknown>[])[0]!.per_model_usage = [
          { model: 'a', current_usage: 0.1 },
          { model: 'b', current_usage: 0.3 },
          { model: 'a', current_usage: 0.1 },
          { model: 'c' },
        ];
      }),
      NOW,
    );
    expect(s.limits.filter((l) => l.scope !== 'key').map((l) => [l.scope, l.scopeLabel, l.kind])).toEqual([
      ['provider', 'openai', 'budget'],
      ['model', 'gpt-4o-mini', 'requests'],
    ]);
    expect(s.modelSpend.map((m) => m.model)).toEqual(['b', 'a']);
    expect(s.modelSpend[1]!.usd).toBeCloseTo(0.2, 10);
  });

  it('reads spend per model from total_cost, as the gateway sends it, highest first', () => {
    type Usage = { model: string; total_cost: number };
    const raw = fixture('quota-200-after-traffic').body as { budgets: { per_model_usage: Usage[] }[] };
    const recorded = raw.budgets[0]!.per_model_usage;
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    const s = normalize(quota('quota-200-after-traffic'), NOW);
    const want = [...recorded].sort((a, b) => b.total_cost - a.total_cost).map((u) => ({ model: u.model, usd: u.total_cost }));
    expect(s.modelSpend).toEqual(want);
  });

  it('prefers total_cost over the older field names', () => {
    const s = normalize(
      quota('quota-200-after-traffic', (b) => {
        (b.budgets as Record<string, unknown>[])[0]!.per_model_usage = [{ model: 'a', total_cost: 0.5, current_usage: 9 }];
      }),
      NOW,
    );
    expect(s.modelSpend).toEqual([{ model: 'a', usd: 0.5 }]);
  });

  it('adds an active admin override to the budget limit (recorded "forever" override)', () => {
    const raw = fixture('quota-200-override').body as { budgets: { max_limit: number; override_amount: number }[] };
    const rb = raw.budgets[0]!;
    expect(rb.override_amount).toBeGreaterThan(0);
    const spent = rb.max_limit + rb.override_amount / 5;
    const b = normalize(quota('quota-200-override', (x) => ((x.budgets as Record<string, unknown>[])[0]!.current_usage = spent)), NOW).limits[0]!;
    expect(b.limit).toBe(rb.max_limit + rb.override_amount);
    expect(b.remaining).toBeCloseTo(b.limit - spent, 10);
    expect(b.percent).toBeLessThan(100);
  });

  it('adds a cycle override only while cycles remain, and ignores unknown modes', () => {
    const limitWith = (extra: Record<string, unknown>) =>
      normalize(quota('quota-200-override', (x) => Object.assign((x.budgets as Record<string, unknown>[])[0]!, extra)), NOW).limits[0]!.limit;
    const base = (fixture('quota-200-override').body as { budgets: { max_limit: number }[] }).budgets[0]!.max_limit;
    expect(limitWith({ override_amount: 3, override_mode: 'cycles', override_cycles_remaining: 2 })).toBe(base + 3);
    expect(limitWith({ override_amount: 3, override_mode: 'cycles', override_cycles_remaining: 0 })).toBe(base);
    expect(limitWith({ override_amount: 3, override_mode: 'other' })).toBe(base);
    expect(limitWith({ override_amount: 0, override_mode: 'forever' })).toBe(base);
    expect(limitWith({ override_amount: undefined, override_mode: undefined })).toBe(base);
  });

  it('treats a null or zero rate limit as not set', () => {
    const s = normalize(
      quota('quota-200-after-traffic', (b) => {
        b.rate_limits = [{ id: 'r', token_max_limit: null, request_max_limit: 0 }];
      }),
      NOW,
    );
    expect(s.limits.map((l) => l.kind)).toEqual(['budget']);
  });
});

const L = (id: string, kind: Limit['kind'], percent: number): Limit => ({
  id, kind, scope: 'key', limit: 100, used: percent, remaining: 100 - percent, percent, nextReset: null, lastReset: null,
});

describe('strictest', () => {
  const limits = [L('b', 'budget', 40), L('t', 'tokens', 70), L('r', 'requests', 70)];
  it.each([
    ['auto picks the highest percent; tie goes to budget/tokens/requests order', 'auto', {}, 't'],
    ['tie goes to the earliest forecast run-out', 'auto', { r: 1_000, t: 2_000 }, 'r'],
    ['a known run-out beats an unknown one', 'auto', { r: 5 }, 'r'],
    ['metric narrows to one kind', 'budget', {}, 'b'],
    ['metric requests', 'requests', {}, 'r'],
  ] as const)('%s', (_, metric, exhaust, want) => {
    expect(strictest(limits, metric, exhaust)?.id).toBe(want);
  });
  it('falls back to all limits when the key has none of the chosen kind', () => {
    expect(strictest([L('b', 'budget', 10)], 'tokens')?.id).toBe('b');
  });
  it('returns null when there is no limit at all', () => {
    expect(strictest([], 'auto')).toBeNull();
  });
});

describe('levelOf', () => {
  it.each([
    [0, 100, 'ok'],
    [74.9, 25.1, 'ok'],
    [75, 25, 'warn'],
    [90, 10, 'critical'],
    [99.6, 0.4, 'critical'],
    [100, 0, 'exhausted'],
    [120, 0, 'exhausted'],
  ] as const)('%s%% used → %s', (percent, remaining, want) => {
    expect(levelOf({ percent, remaining }, 75, 90)).toBe(want);
  });
});
