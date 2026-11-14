// Typed, clamped view of the `bifrostMeter.*` settings. Pure: the caller passes a getter (VS Code configuration in the
// extension, a plain object in tests). Defaults live in package.json; the fallbacks here only guard against bad values.

import type { LanguageSetting, Metric } from '../core';

export type StatusFormat = 'full' | 'compact' | 'percent';

export interface Settings {
  baseUrl: string;
  pollIntervalSeconds: number;
  warn: number;
  critical: number;
  metric: Metric;
  format: StatusFormat;
  notifications: boolean;
  forecastWindowMinutes: number;
  language: LanguageSetting;
  allowInsecureHttp: boolean;
}

export const MIN_POLL_SECONDS = 15;

type Getter = (key: string) => unknown;

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function readSettings(get: Getter): Settings {
  const warn = clamp(num(get('thresholds.warn'), 75), 1, 100);
  const critical = clamp(num(get('thresholds.critical'), 90), 1, 100);
  const base = get('baseUrl');
  return {
    baseUrl: typeof base === 'string' && base.trim() ? base.trim() : 'http://localhost:8080',
    pollIntervalSeconds: Math.max(MIN_POLL_SECONDS, num(get('pollIntervalSeconds'), 60)),
    // A critical threshold below the warning one would skip the warning; keep them ordered.
    warn: Math.min(warn, critical),
    critical: Math.max(warn, critical),
    metric: pick(get('statusBar.metric'), ['auto', 'budget', 'tokens', 'requests'] as const, 'auto'),
    format: pick(get('statusBar.format'), ['full', 'compact', 'percent'] as const, 'full'),
    notifications: get('notifications.enabled') !== false,
    forecastWindowMinutes: clamp(num(get('forecast.windowMinutes'), 30), 5, 24 * 60),
    language: pick(get('language'), ['auto', 'en', 'ms'] as const, 'auto'),
    allowInsecureHttp: get('allowInsecureHttp') === true,
  };
}
