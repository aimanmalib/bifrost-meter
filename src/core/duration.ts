// Bifrost reset windows, computed the way the gateway computes them (framework/configstore/tables/utils.go, v2.5.1).
//
// Rolling windows have a fixed length: Go-style durations such as "30s", "5m" and "1h30m", plus the gateway's own units,
// where "d" is 24 hours, "w" 7 days, "M" 30 days, "Q" 90 days and "Y" 365 days. The gateway keeps last_reset on a lattice
// of that length, so the next reset is last_reset plus a whole number of lengths.
//
// A key can also be calendar aligned. Its "1d", "1w", "1M", "1Q" and "1Y" windows then reset at 00:00 UTC on the next
// day, Monday, first of the month, first of the quarter or 1 January. The quota response does not say which kind a
// window is, so it is inferred: an alignable duration whose last_reset sits exactly on its own calendar boundary is
// treated as calendar aligned. Unparseable strings return null so callers can show the raw text without a countdown.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: HOUR,
  d: DAY,
  w: 7 * DAY,
  M: 30 * DAY,
  Q: 90 * DAY,
  Y: 365 * DAY,
};

export type CalendarUnit = 'd' | 'w' | 'M' | 'Q' | 'Y';

export interface Duration {
  /** Rolling length in milliseconds. */
  ms: number;
  /** Set for "1d", "1w", "1M", "1Q" and "1Y", the only durations the gateway can align to the calendar. */
  calendar?: CalendarUnit;
}

const TOKEN = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|Q|Y)/g;
const ALIGNABLE = /^1([dwMQY])$/;

export function parseDuration(raw: string | null | undefined): Duration | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;
  let consumed = 0;
  let ms = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index !== consumed) return null;
    consumed += m[0].length;
    ms += Number(m[1]) * (UNIT_MS[m[2] as string] as number);
  }
  if (consumed !== text.length || ms <= 0) return null;
  const unit = ALIGNABLE.exec(text)?.[1] as CalendarUnit | undefined;
  return unit ? { ms, calendar: unit } : { ms };
}

/** First month of the first quarter as 1 to 12; anything else reads as January, as on the gateway. */
const quarterMonth = (v: number | null | undefined): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12 ? v : 1);

/** Start (UTC) of the calendar period of `unit` that contains `t`. */
export function periodStart(unit: CalendarUnit, t: number, quarterStartMonth?: number | null): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (unit) {
    case 'd':
      return Date.UTC(y, m, day);
    case 'w':
      return Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)); // most recent Monday
    case 'M':
      return Date.UTC(y, m, 1);
    case 'Q': {
      // Absolute months, so a fiscal quarter that began in the previous calendar year needs no special case.
      const absolute = y * 12 + m;
      const first = absolute - ((((absolute - (quarterMonth(quarterStartMonth) - 1)) % 3) + 3) % 3);
      return Date.UTC(Math.floor(first / 12), first % 12, 1);
    }
    case 'Y':
      return Date.UTC(y, 0, 1);
  }
}

/** Start (UTC) of the period after the one that begins at `start`. */
function periodEnd(unit: CalendarUnit, start: number): number {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (unit) {
    case 'd':
      return Date.UTC(y, m, day + 1);
    case 'w':
      return Date.UTC(y, m, day + 7);
    case 'M':
      return Date.UTC(y, m + 1, 1);
    case 'Q':
      return Date.UTC(y, m + 3, 1);
    case 'Y':
      return Date.UTC(y + 1, 0, 1);
  }
}

/**
 * Next reset after `now`, given the last reset and the period. The gateway resets lazily, so the window that started at
 * last_reset can already be over; the result is then the end of the window that contains `now`. Returns null when either
 * input is unusable. `quarterStartMonth` is the budget's reset_config.quarter_start_month and only matters for "1Q".
 */
export function nextReset(
  lastReset: string | null | undefined,
  period: Duration | null,
  now: number,
  quarterStartMonth?: number | null,
): number | null {
  if (!period || typeof lastReset !== 'string') return null;
  const start = Date.parse(lastReset);
  if (!Number.isFinite(start)) return null;
  if (period.calendar && start === periodStart(period.calendar, start, quarterStartMonth)) {
    return periodEnd(period.calendar, periodStart(period.calendar, Math.max(now, start), quarterStartMonth));
  }
  const steps = Math.max(1, Math.floor((now - start) / period.ms) + 1);
  const next = start + steps * period.ms;
  return next > now ? next : null;
}
