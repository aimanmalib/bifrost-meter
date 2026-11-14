import type { Language, Limit } from '../../src/core';
import { translator } from '../../src/core';
import { readSettings, type Settings } from '../../src/extension/settings';
import type { Ctx } from '../../src/extension/view';

export const NOW = Date.parse('2026-11-14T15:00:00Z');
export const HOUR = 3_600_000;

export const settings = (over: Partial<Settings> = {}): Settings => ({ ...readSettings(() => undefined), ...over });

export const ctx = (lang: Language = 'en', over: Partial<Settings> = {}, now = NOW): Ctx => ({
  t: translator(lang),
  lang,
  now,
  settings: settings(over),
});

export function limit(over: Partial<Limit> = {}): Limit {
  const l: Limit = {
    id: 'budget:a',
    kind: 'budget',
    scope: 'key',
    limit: 10,
    used: 6.2,
    remaining: 3.8,
    percent: 62,
    resetRaw: '1d',
    nextReset: NOW + 4 * HOUR,
    lastReset: NOW - 20 * HOUR,
    ...over,
  };
  if (over.used !== undefined && over.remaining === undefined) l.remaining = Math.max(0, l.limit - l.used);
  if (over.used !== undefined && over.percent === undefined) l.percent = (l.used / l.limit) * 100;
  return l;
}
