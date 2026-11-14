import { describe, expect, it } from 'vitest';
import { addSample, forecast, MAX_SAMPLES, type Sample } from '../../src/core/forecast';

const MIN = 60_000;
const T0 = Date.parse('2026-11-14T12:00:00Z');
const s = (min: number, used: number): Sample => ({ t: T0 + min * MIN, used });

describe('addSample', () => {
  it('starts a series', () => {
    expect(addSample(undefined, s(0, 1), 'c1')).toEqual({ cycle: 'c1', samples: [s(0, 1)] });
  });
  it('appends inside the same cycle', () => {
    const a = addSample(addSample(undefined, s(0, 1), 'c1'), s(1, 2), 'c1');
    expect(a.samples).toHaveLength(2);
  });
  it('starts over when the reset cycle changes', () => {
    const a = addSample(addSample(undefined, s(0, 1), 'c1'), s(1, 2), 'c2');
    expect(a).toEqual({ cycle: 'c2', samples: [s(1, 2)] });
  });
  it('starts over when usage goes down', () => {
    const a = addSample(addSample(undefined, s(0, 5), 'c1'), s(1, 2), 'c1');
    expect(a.samples).toEqual([s(1, 2)]);
  });
  it('ignores a sample that is not newer', () => {
    const a = addSample(undefined, s(1, 1), 'c1');
    expect(addSample(a, s(1, 3), 'c1')).toBe(a);
  });
  it(`keeps at most ${MAX_SAMPLES} samples, dropping the oldest`, () => {
    let series = addSample(undefined, s(0, 0), 'c');
    for (let i = 1; i <= MAX_SAMPLES + 10; i++) series = addSample(series, s(i, i), 'c');
    expect(series.samples).toHaveLength(MAX_SAMPLES);
    expect(series.samples[0]).toEqual(s(11, 11));
  });
});

describe('forecast', () => {
  const base = { now: T0 + 10 * MIN, windowMs: 30 * MIN, remaining: 100, nextReset: T0 + 24 * 60 * MIN };
  it.each([
    ['one sample is not enough', [s(10, 5)], 'insufficient'],
    ['two samples under two minutes apart are not enough', [s(9, 1), s(10, 2)], 'insufficient'],
    ['samples outside the window do not count', [s(-60, 0), s(10, 2)], 'insufficient'],
    ['flat usage', [s(0, 3), s(5, 3), s(10, 3)], 'steady'],
  ] as const)('%s', (_, samples, status) => {
    expect(forecast({ ...base, samples: [...samples] }).status).toBe(status);
  });

  it('is exhausted when nothing remains', () => {
    expect(forecast({ ...base, samples: [], remaining: 0 }).status).toBe('exhausted');
  });

  it('projects a linear run-out before the reset', () => {
    // 1 unit per minute, 100 left → runs out 100 minutes after now, long before the reset 24 h after T0.
    const f = forecast({ ...base, samples: [s(0, 0), s(5, 5), s(10, 10)] });
    if (f.status !== 'rising') throw new Error(f.status);
    expect(f.ratePerHour).toBeCloseTo(60, 6);
    expect(f.exhaustAt).toBeCloseTo(base.now + 100 * MIN, -1);
    expect(f.beforeReset).toBe(true);
    expect(f.leadMs).toBeCloseTo(base.nextReset - f.exhaustAt, -1);
  });

  it('does not warn when the run-out is after the reset', () => {
    const f = forecast({ ...base, remaining: 100_000, samples: [s(0, 0), s(10, 10)] });
    expect(f).toMatchObject({ status: 'rising', beforeReset: false, leadMs: 0 });
  });

  it('does not claim before-reset when the reset time is unknown', () => {
    const f = forecast({ ...base, nextReset: null, samples: [s(0, 0), s(10, 10)] });
    expect(f).toMatchObject({ status: 'rising', beforeReset: false });
  });
});
