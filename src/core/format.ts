// Number, money, duration and clock formatting. Rounding never flatters: percent used rounds down (99.6% stays "99.6%",
// not "100%"), money left rounds down, money spent rounds up.

import { intlLocale, type Language, type Translate } from './i18n';

export type Rounding = 'floor' | 'ceil';

const EPS = 1e-9;

function round(value: number, digits: number, mode: Rounding): number {
  const scale = 10 ** digits;
  const scaled = value * scale;
  return (mode === 'floor' ? Math.floor(scaled + EPS) : Math.ceil(scaled - EPS)) / scale;
}

const num = (lang: Language, digits: number, value: number): string =>
  new Intl.NumberFormat(intlLocale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

/** Percent used. Whole numbers in the middle of the range; one decimal near 0 and near 100 so small changes stay visible. */
export function formatPercent(p: number, lang: Language, t: Translate): string {
  if (!Number.isFinite(p)) return t('percent.over');
  if (p >= 100) return `${num(lang, 0, Math.floor(p + EPS))}%`;
  if (p <= 0) return `${num(lang, 0, 0)}%`;
  if (p < 1 || p >= 99) {
    const v = round(p, 1, 'floor');
    return v === 0 ? t('percent.lessThanTenth') : `${num(lang, 1, v)}%`;
  }
  return `${num(lang, 0, Math.floor(p + EPS))}%`;
}

/** US dollars. Two decimals, or four when a non-zero amount is below one cent. */
export function formatUsd(value: number, lang: Language, mode: Rounding): string {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(round(value, digits, mode));
}

/** Token or request counts: 950, 98.9k, 1.2M (suffixes from the language bundle). */
export function formatCount(value: number, lang: Language, t: Translate, mode: Rounding): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return num(lang, 0, mode === 'floor' ? Math.floor(value + EPS) : Math.ceil(value - EPS));
  if (abs < 1_000_000) {
    const v = round(value / 1_000, 1, mode);
    if (Math.abs(v) < 1_000) return t('count.thousands', trimmed(lang, v));
  }
  return t('count.millions', trimmed(lang, round(value / 1_000_000, 1, mode)));
}

const trimmed = (lang: Language, v: number): string =>
  new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 }).format(v);

/** Time span such as "4h", "2h 5m", "3d 4h", "<1m". Two largest units, rounded down. */
export function formatDuration(ms: number, t: Translate): string {
  if (!(ms >= 60_000)) return t('duration.lessThanMinute');
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1_440);
  const h = Math.floor((totalMin % 1_440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(t('duration.days', d));
  if (h > 0) parts.push(t('duration.hours', h));
  if (m > 0 && d === 0) parts.push(t('duration.minutes', m));
  return parts.slice(0, 2).join(' ');
}

/** Wall-clock time, 24-hour, for "runs out around HH:MM". `timeZone` is for tests; callers omit it. */
export function formatClock(epochMs: number, lang: Language, timeZone?: string): string {
  return new Intl.DateTimeFormat(intlLocale(lang), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(epochMs);
}
