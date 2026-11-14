// Keeps usage samples per limit and turns them into run-out forecasts. Pure: the caller persists the store.

import { addSample, forecast, type Forecast, type Limit, type Series } from '../core';

export type SeriesStore = Record<string, Series>;

/** The reset cycle a sample belongs to: a new last-reset (or next-reset) time means a new cycle. */
export const cycleOf = (l: Limit): string => String(l.lastReset ?? l.nextReset ?? 'none');

export function trackForecasts(
  store: SeriesStore,
  limits: Limit[],
  now: number,
  windowMinutes: number,
): { store: SeriesStore; forecasts: Record<string, Forecast> } {
  const next: SeriesStore = {};
  const forecasts: Record<string, Forecast> = {};
  for (const l of limits) {
    const series = addSample(store[l.id], { t: now, used: l.used }, cycleOf(l));
    next[l.id] = series;
    forecasts[l.id] = forecast({
      samples: series.samples,
      now,
      windowMs: windowMinutes * 60_000,
      remaining: l.remaining,
      nextReset: l.nextReset,
    });
  }
  // Limits that disappeared from the response are dropped, so the store cannot grow without bound.
  return { store: next, forecasts };
}
