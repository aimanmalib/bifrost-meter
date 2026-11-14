// Bifrost reset durations: Go-style sequences such as "30s", "1h30m", "1d", "1w", plus calendar units "1M" (month) and
// "1Y" (year). Unparseable strings return null so callers can show the raw text without a countdown.

const FIXED_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export interface Duration {
  /** Fixed part in milliseconds. */
  ms: number;
  /** Calendar months (a year counts as 12). */
  months: number;
}

const TOKEN = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y|Y)/g;

export function parseDuration(raw: string | null | undefined): Duration | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;
  let consumed = 0;
  let ms = 0;
  let months = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index !== consumed) return null;
    consumed += m[0].length;
    const n = Number(m[1]);
    const unit = m[2] as string;
    if (unit === 'M') {
      if (!Number.isInteger(n)) return null;
      months += n;
    } else if (unit === 'y' || unit === 'Y') {
      if (!Number.isInteger(n)) return null;
      months += n * 12;
    } else {
      ms += n * (FIXED_MS[unit] as number);
    }
  }
  if (consumed !== text.length || (ms === 0 && months === 0)) return null;
  return { ms, months };
}

function addOnce(from: number, d: Duration): number {
  let t = from;
  if (d.months > 0) {
    const date = new Date(t);
    date.setUTCMonth(date.getUTCMonth() + d.months);
    t = date.getTime();
  }
  return t + d.ms;
}

/**
 * Next reset after `now`, given the last reset and the period. The gateway resets lazily, so `lastReset + period` can be in
 * the past; in that case the period is stepped forward until it passes `now`. Returns null when either input is unusable.
 */
export function nextReset(lastReset: string | null | undefined, period: Duration | null, now: number): number | null {
  if (!period || typeof lastReset !== 'string') return null;
  const start = Date.parse(lastReset);
  if (!Number.isFinite(start)) return null;
  let t = addOnce(start, period);
  if (t <= now && period.months === 0) {
    const steps = Math.floor((now - t) / period.ms) + 1;
    t += steps * period.ms;
  }
  for (let guard = 0; t <= now && guard < 10_000; guard++) t = addOnce(t, period);
  return t > now ? t : null;
}
