import { describe, expect, it } from 'vitest';
import { nextReset, parseDuration } from '../../src/core/duration';

const H = 3_600_000;

describe('parseDuration', () => {
  it.each([
    ['30s', { ms: 30_000, months: 0 }],
    ['1m', { ms: 60_000, months: 0 }],
    ['1h', { ms: H, months: 0 }],
    ['1h30m', { ms: 1.5 * H, months: 0 }],
    ['1d', { ms: 24 * H, months: 0 }],
    ['1w', { ms: 168 * H, months: 0 }],
    ['1M', { ms: 0, months: 1 }],
    ['1Y', { ms: 0, months: 12 }],
    [' 2h ', { ms: 2 * H, months: 0 }],
  ])('%s', (raw, want) => expect(parseDuration(raw)).toEqual(want));

  it.each([undefined, null, '', 'daily', '1x', 'h1', '1h foo', '0s', '1.5M', '-1h'])('rejects %j', (raw) => {
    expect(parseDuration(raw as string)).toBeNull();
  });
});

describe('nextReset', () => {
  const last = '2026-11-14T10:00:00Z';
  const t0 = Date.parse(last);
  it('adds the period once when it is still ahead', () => {
    expect(nextReset(last, parseDuration('1h'), t0 + 10 * 60_000)).toBe(t0 + H);
  });
  it('steps forward past now when the gateway has not reset yet', () => {
    expect(nextReset(last, parseDuration('1h'), t0 + 3.5 * H)).toBe(t0 + 4 * H);
  });
  it('handles calendar months', () => {
    expect(nextReset('2026-01-31T00:00:00Z', parseDuration('1M'), Date.parse('2026-02-01T00:00:00Z'))).toBe(
      Date.parse('2026-03-03T00:00:00Z'),
    );
  });
  it.each([
    ['bad period', last, null],
    ['bad time', 'yesterday', parseDuration('1h')],
    ['no time', undefined, parseDuration('1h')],
  ])('%s gives null', (_, l, p) => expect(nextReset(l as string, p, t0)).toBeNull());
});
