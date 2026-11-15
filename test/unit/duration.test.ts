import { describe, expect, it } from 'vitest';
import { nextReset, parseDuration, periodStart } from '../../src/core/duration';

const H = 3_600_000;
const D = 24 * H;
const at = (iso: string): number => Date.parse(iso);

describe('parseDuration', () => {
  // Lengths follow the gateway's ParseDuration: a month is 30 days, a quarter 90 and a year 365.
  it.each([
    ['30s', { ms: 30_000 }],
    ['1m', { ms: 60_000 }],
    ['1h', { ms: H }],
    ['1h30m', { ms: 1.5 * H }],
    ['1.5h', { ms: 1.5 * H }],
    ['7d', { ms: 7 * D }],
    ['2w', { ms: 14 * D }],
    ['3M', { ms: 90 * D }],
    ['1.5M', { ms: 45 * D }],
    [' 2h ', { ms: 2 * H }],
  ])('%s is a rolling window', (raw, want) => expect(parseDuration(raw)).toEqual(want));

  it.each([
    ['1d', { ms: D, calendar: 'd' }],
    ['1w', { ms: 7 * D, calendar: 'w' }],
    ['1M', { ms: 30 * D, calendar: 'M' }],
    ['1Q', { ms: 90 * D, calendar: 'Q' }],
    ['1Y', { ms: 365 * D, calendar: 'Y' }],
  ])('%s can be calendar aligned', (raw, want) => expect(parseDuration(raw)).toEqual(want));

  it.each([undefined, null, '', 'daily', '1x', 'h1', '1h foo', '0s', '1y', '-1h'])('rejects %j', (raw) => {
    expect(parseDuration(raw as string)).toBeNull();
  });
});

describe('periodStart', () => {
  const t = at('2026-11-15T04:06:27.861Z'); // a Sunday
  it.each([
    ['d', '2026-11-15T00:00:00Z'],
    ['w', '2026-11-09T00:00:00Z'],
    ['M', '2026-11-01T00:00:00Z'],
    ['Q', '2026-10-01T00:00:00Z'],
    ['Y', '2026-01-01T00:00:00Z'],
  ] as const)('%s snaps to %s, as measured on the gateway', (unit, want) => expect(periodStart(unit, t)).toBe(at(want)));

  it('uses the fiscal quarter start, also across a year boundary', () => {
    expect(periodStart('Q', at('2026-01-20T10:00:00Z'), 11)).toBe(at('2025-11-01T00:00:00Z'));
    expect(periodStart('Q', at('2026-05-20T10:00:00Z'), 2)).toBe(at('2026-05-01T00:00:00Z'));
    expect(periodStart('Q', at('2026-05-20T10:00:00Z'), 4)).toBe(at('2026-04-01T00:00:00Z'));
    expect(periodStart('Q', at('2026-05-20T10:00:00Z'), 99)).toBe(at('2026-04-01T00:00:00Z'));
  });
});

describe('nextReset on a rolling window', () => {
  const last = '2026-11-14T10:00:00Z';
  const t0 = at(last);
  it('adds the period once when it is still ahead', () => {
    expect(nextReset(last, parseDuration('1h'), t0 + 10 * 60_000)).toBe(t0 + H);
  });
  it('steps forward past now when the gateway has not reset yet', () => {
    expect(nextReset(last, parseDuration('1h'), t0 + 3.5 * H)).toBe(t0 + 4 * H);
  });
  it('moves to the following window exactly on a boundary', () => {
    expect(nextReset(last, parseDuration('1h'), t0 + H)).toBe(t0 + 2 * H);
  });
  it('keeps the first window when the clock is behind last_reset', () => {
    expect(nextReset(last, parseDuration('1h'), t0 - 5_000)).toBe(t0 + H);
  });
  it('counts a month as 30 days, a quarter as 90 and a year as 365 when last_reset is off the calendar grid', () => {
    const created = '2026-10-10T13:45:12.123Z';
    const now = at(created) + D;
    expect(nextReset(created, parseDuration('1M'), now)).toBe(at('2026-11-09T13:45:12.123Z'));
    expect(nextReset(created, parseDuration('1Q'), now)).toBe(at('2027-01-08T13:45:12.123Z'));
    expect(nextReset(created, parseDuration('1Y'), now)).toBe(at('2027-10-10T13:45:12.123Z'));
  });
  it('reads the nanosecond timestamps the gateway sends', () => {
    // Measured on v2.5.1: a "1m" budget created at ...27.847221039Z had last_reset ...27.847221039Z one minute later.
    expect(nextReset('2026-11-15T04:07:27.847221039Z', parseDuration('1m'), at('2026-11-15T04:07:53Z'))).toBe(
      at('2026-11-15T04:08:27.847Z'),
    );
  });
});

describe('nextReset on a calendar-aligned window', () => {
  // last_reset values measured on v2.5.1 for keys created with calendar_aligned on 2026-11-15 (a Sunday).
  const now = at('2026-11-15T04:06:28Z');
  it.each([
    ['1d', '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z'],
    ['1w', '2026-11-09T00:00:00Z', '2026-11-16T00:00:00Z'],
    ['1M', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'],
    ['1Q', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'],
    ['1Y', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'],
  ])('%s from %s resets at %s', (raw, last, want) => expect(nextReset(last, parseDuration(raw), now)).toBe(at(want)));

  it('ends a 31-day month on the first of the next one, not after 30 days', () => {
    expect(nextReset('2026-12-01T00:00:00Z', parseDuration('1M'), at('2026-12-20T00:00:00Z'))).toBe(at('2027-01-01T00:00:00Z'));
  });
  it('uses the window that contains now when the gateway has not reset yet', () => {
    expect(nextReset('2026-09-01T00:00:00Z', parseDuration('1M'), now)).toBe(at('2026-12-01T00:00:00Z'));
  });
  it('follows the fiscal quarter start of the budget', () => {
    expect(nextReset('2026-11-01T00:00:00Z', parseDuration('1Q'), now, 2)).toBe(at('2027-02-01T00:00:00Z'));
  });
  it('treats a quarter that starts off the fiscal grid as rolling', () => {
    expect(nextReset('2026-11-01T00:00:00Z', parseDuration('1Q'), now, 1)).toBe(at('2026-11-01T00:00:00Z') + 90 * D);
  });
  it('does not align a multiple such as 2w', () => {
    expect(nextReset('2026-11-09T00:00:00Z', parseDuration('2w'), now)).toBe(at('2026-11-23T00:00:00Z'));
  });
});

describe('nextReset with unusable input', () => {
  const last = '2026-11-14T10:00:00Z';
  it.each([
    ['bad period', last, null],
    ['bad time', 'yesterday', parseDuration('1h')],
    ['no time', undefined, parseDuration('1h')],
  ])('%s gives null', (_, l, p) => expect(nextReset(l as string, p, at(last))).toBeNull());
});
