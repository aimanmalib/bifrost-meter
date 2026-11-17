// Fields that pending upstream changes add to the quota response (calendar_aligned, next_reset, token_next_reset,
// request_next_reset, effective_max_limit). The fixture's shape comes from the OpenAPI schema in those pull requests and was
// not recorded from a released gateway; v2.5.1 sends none of these fields.
import { describe, expect, it } from 'vitest';
import { normalize, type Limit } from '../../src/core/model';
import { parseQuota, type QuotaResponse } from '../../src/core/schema';
import { body } from './fixtures';

const NOW = Date.parse('2026-11-17T10:15:00Z');
const at = (iso: string): number => Date.parse(iso);

type Obj = Record<string, unknown>;
/** The parts of the response body these tests change. */
interface Body extends Obj {
  budgets: Obj[];
  rate_limit: Obj;
  rate_limits: Obj[];
}

function quota(name: string, mutate?: (b: Body) => void): QuotaResponse {
  const b = body(name) as Body;
  mutate?.(b);
  const r = parseQuota(b);
  if (!r.ok) throw new Error(r.field);
  return r.value;
}

const upstream = (mutate?: (b: Body) => void): QuotaResponse => quota('quota-200-upstream-next-reset', mutate);
const byKind = (limits: Limit[], kind: Limit['kind']): Limit => limits.find((l) => l.kind === kind)!;

/** Applies the same change to rate_limit and every rate_limits entry, as the gateway would. */
const eachRate = (b: Body, f: (r: Obj) => void): void => {
  f(b.rate_limit);
  for (const r of b.rate_limits) f(r);
};

describe('upstream quota fields', () => {
  it('reads the upstream-shaped fixture with every new field', () => {
    const s = normalize(upstream(), NOW);
    expect(s.calendarAligned).toBe(true);
    expect(byKind(s.limits, 'budget')).toMatchObject({ limit: 10, used: 1.25, nextReset: at('2026-12-01T00:00:00Z') });
    expect(byKind(s.limits, 'tokens').nextReset).toBe(at('2026-11-17T11:00:00Z'));
    expect(byKind(s.limits, 'requests').nextReset).toBe(at('2026-11-17T10:16:00Z'));
  });

  it('uses the gateway next_reset over its own calculation when they differ', () => {
    // A rolling window anchored somewhere other than last_reset: only the gateway knows the anchor.
    const s = normalize(
      upstream((b) => {
        b.budgets[0]!.next_reset = '2026-11-20T06:00:00Z';
        eachRate(b, (r) => {
          r.token_next_reset = '2026-11-17T10:40:00Z';
          r.request_next_reset = '2026-11-17T10:15:30Z';
        });
      }),
      NOW,
    );
    expect(byKind(s.limits, 'budget').nextReset).toBe(at('2026-11-20T06:00:00Z'));
    expect(byKind(s.limits, 'tokens').nextReset).toBe(at('2026-11-17T10:40:00Z'));
    expect(byKind(s.limits, 'requests').nextReset).toBe(at('2026-11-17T10:15:30Z'));
  });

  it('uses effective_max_limit as the enforced limit when the gateway sends it', () => {
    // Without the field, a "cycles" override with no cycles count reads as inactive (limit 5); the gateway knows better.
    const s = normalize(
      upstream((b) => {
        delete b.budgets[0]!.override_cycles_remaining;
        b.budgets[0]!.effective_max_limit = 12;
      }),
      NOW,
    );
    expect(byKind(s.limits, 'budget')).toMatchObject({ limit: 12, remaining: 10.75 });
  });

  it('falls back to its own calculation when the new fields are absent', () => {
    const s = normalize(
      upstream((b) => {
        delete b.calendar_aligned;
        delete b.budgets[0]!.next_reset;
        delete b.budgets[0]!.effective_max_limit;
        eachRate(b, (r) => {
          delete r.token_next_reset;
          delete r.request_next_reset;
        });
      }),
      NOW,
    );
    expect(s.calendarAligned).toBeUndefined();
    // Override active for one more cycle: 5 + 5. Calendar month inferred from last_reset on 1 November.
    expect(byKind(s.limits, 'budget')).toMatchObject({ limit: 10, nextReset: at('2026-12-01T00:00:00Z') });
    expect(byKind(s.limits, 'tokens').nextReset).toBe(at('2026-11-17T11:00:00Z'));
    expect(byKind(s.limits, 'requests').nextReset).toBe(at('2026-11-17T10:16:00Z'));
  });

  it('ignores malformed new fields instead of failing the whole reading', () => {
    const s = normalize(
      upstream((b) => {
        b.calendar_aligned = 'yes';
        b.budgets[0]!.next_reset = 'soon';
        b.budgets[0]!.effective_max_limit = -1;
        eachRate(b, (rl) => {
          rl.token_next_reset = 1700000000;
          rl.request_next_reset = '';
        });
      }),
      NOW,
    );
    expect(s.calendarAligned).toBeUndefined();
    expect(byKind(s.limits, 'budget')).toMatchObject({ limit: 10, nextReset: at('2026-12-01T00:00:00Z') });
    expect(byKind(s.limits, 'tokens').nextReset).toBe(at('2026-11-17T11:00:00Z'));
    expect(byKind(s.limits, 'requests').nextReset).toBe(at('2026-11-17T10:16:00Z'));
  });

  it('ignores a gateway next_reset that is already past and computes the current window instead', () => {
    // A reading taken later than the gateway answered (cached or slow clock): the reported reset has gone by.
    const later = at('2026-11-17T11:05:00Z');
    const s = normalize(upstream(), later);
    expect(byKind(s.limits, 'tokens').nextReset).toBe(at('2026-11-17T12:00:00Z'));
  });

  it('reads recorded v2.5.1 responses exactly as before', () => {
    for (const name of ['quota-200-fresh', 'quota-200-after-traffic', 'quota-200-override', 'quota-200-no-limits']) {
      const s = normalize(quota(name), NOW);
      expect(s.calendarAligned).toBeUndefined();
    }
    const override = normalize(quota('quota-200-override'), NOW);
    expect(byKind(override.limits, 'budget').limit).toBe(10);
  });
});
