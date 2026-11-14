import { describe, expect, it } from 'vitest';
import { formatClock, formatCount, formatDuration, formatPercent, formatUsd } from '../../src/core/format';
import { translator } from '../../src/core/i18n';

const en = translator('en');
const ms = translator('ms');
const MIN = 60_000;

describe('formatPercent never rounds up to a full limit', () => {
  it.each([
    [0, '0%'],
    [0.0066, '<0.1%'],
    [0.25, '0.2%'],
    [1, '1%'],
    [62.9, '62%'],
    [98.99, '98%'],
    [99, '99.0%'],
    [99.6, '99.6%'],
    [99.99, '99.9%'],
    [100, '100%'],
    [112.4, '112%'],
  ])('%s → %s', (p, want) => expect(formatPercent(p, 'en', en)).toBe(want));
  it('has a word for an over-limit zero budget', () => {
    expect(formatPercent(Infinity, 'ms', ms)).toBe('melebihi had');
  });
});

describe('formatUsd', () => {
  it.each([
    [4.99967, 'floor', '$4.99'],
    [0.00033, 'ceil', '$0.0004'],
    [0.00033, 'floor', '$0.0003'],
    [3.8, 'floor', '$3.80'],
    [0, 'floor', '$0.00'],
    [1234.5, 'floor', '$1,234.50'],
  ] as const)('%s (%s) → %s', (v, mode, want) => expect(formatUsd(v, 'en', mode)).toBe(want));
  it('uses the dollar sign in Malay too', () => {
    expect(formatUsd(3.8, 'ms', 'floor')).toBe('$3.80');
  });
});

describe('formatCount', () => {
  it.each([
    [950, 'floor', '950'],
    [99_000, 'floor', '99k'],
    [98_950, 'floor', '98.9k'],
    [98_950, 'ceil', '99k'],
    [999_999, 'floor', '999.9k'],
    [999_999, 'ceil', '1M'],
    [1_250_000, 'floor', '1.2M'],
  ] as const)('%s (%s) → %s', (v, mode, want) => expect(formatCount(v, 'en', en, mode)).toBe(want));
  it('uses Malay suffixes', () => {
    expect(formatCount(2_500_000, 'ms', ms, 'floor')).toBe('2.5J');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '<1m'],
    [59_999, '<1m'],
    [MIN, '1m'],
    [4 * 60 * MIN, '4h'],
    [125 * MIN, '2h 5m'],
    [(3 * 24 + 4) * 60 * MIN + 7 * MIN, '3d 4h'],
    [2 * 24 * 60 * MIN, '2d'],
  ])('%s ms → %s', (v, want) => expect(formatDuration(v, en)).toBe(want));
  it('uses Malay units (h = hari, j = jam)', () => {
    expect(formatDuration((24 + 4) * 60 * MIN, ms)).toBe('1h 4j');
  });
});

describe('formatClock', () => {
  it('is 24-hour HH:MM', () => {
    expect(formatClock(Date.parse('2026-11-14T15:07:00Z'), 'en', 'UTC')).toBe('15:07');
    expect(formatClock(Date.parse('2026-11-14T15:07:00Z'), 'ms', 'Asia/Kuala_Lumpur')).toBe('23:07');
  });
});
