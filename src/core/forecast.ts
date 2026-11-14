// Run-out forecast from usage samples. Pure functions: the caller owns storage (VS Code globalState, a file, memory).

export interface Sample {
  /** Epoch ms. */
  t: number;
  used: number;
}

export interface Series {
  /** Identifies the reset cycle the samples belong to (the last-reset time, or the next-reset time). */
  cycle: string;
  samples: Sample[];
}

export const MAX_SAMPLES = 500;
export const MIN_SAMPLES = 2;
export const MIN_SPAN_MS = 2 * 60_000;

/**
 * Adds a sample. The series starts over when the reset cycle changes or usage goes down (a reset or a correction), because
 * a slope across a reset means nothing. Keeps at most `max` samples, dropping the oldest.
 */
export function addSample(series: Series | undefined, sample: Sample, cycle: string, max = MAX_SAMPLES): Series {
  if (!series || series.cycle !== cycle) return { cycle, samples: [sample] };
  const last = series.samples[series.samples.length - 1];
  if (last && sample.used < last.used) return { cycle, samples: [sample] };
  if (last && sample.t <= last.t) return series;
  const samples = [...series.samples, sample];
  return { cycle, samples: samples.length > max ? samples.slice(samples.length - max) : samples };
}

export type Forecast =
  | { status: 'insufficient' }
  | { status: 'steady' }
  | { status: 'exhausted' }
  | {
      status: 'rising';
      /** Units per hour (USD, tokens or requests). */
      ratePerHour: number;
      /** Epoch ms when the limit is expected to run out. */
      exhaustAt: number;
      /** True when that is before the next reset (the case worth a warning). */
      beforeReset: boolean;
      /** How long before the reset it runs out, in ms; 0 when not before reset or the reset is unknown. */
      leadMs: number;
    };

export interface ForecastInput {
  samples: Sample[];
  now: number;
  /** Look-back window in ms (setting `forecast.windowMinutes`, default 30). */
  windowMs: number;
  remaining: number;
  nextReset: number | null;
}

/** Least-squares slope (units per ms) over the samples inside the window. */
function slope(points: Sample[]): number {
  const n = points.length;
  const t0 = points[0]?.t ?? 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const x = p.t - t0;
    sx += x;
    sy += p.used;
    sxx += x * x;
    sxy += x * p.used;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

export function forecast(input: ForecastInput): Forecast {
  if (input.remaining <= 0) return { status: 'exhausted' };
  const from = input.now - input.windowMs;
  const points = input.samples.filter((s) => s.t >= from && s.t <= input.now);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < MIN_SAMPLES || !first || !last || last.t - first.t < MIN_SPAN_MS) return { status: 'insufficient' };
  const perMs = slope(points);
  if (!(perMs > 0)) return { status: 'steady' };
  const exhaustAt = input.now + input.remaining / perMs;
  const beforeReset = input.nextReset !== null && exhaustAt < input.nextReset;
  return {
    status: 'rising',
    ratePerHour: perMs * 3_600_000,
    exhaustAt,
    beforeReset,
    leadMs: beforeReset && input.nextReset !== null ? input.nextReset - exhaustAt : 0,
  };
}
