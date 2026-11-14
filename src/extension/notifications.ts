// Decides which threshold and forecast notifications to show. Pure: one notification per threshold per reset cycle, and
// one per cycle when the forecast says the limit runs out before it resets. The caller persists the returned store.

import { levelOf, type Forecast, type Level, type Limit } from '../core';
import { cycleOf } from './forecasts';
import type { Settings } from './settings';

export interface NoteState {
  cycle: string;
  /** Highest threshold already announced in this cycle. */
  level: Level;
  forecast: boolean;
}

export type NoteStore = Record<string, NoteState>;

export type Note =
  | { kind: 'threshold'; level: Exclude<Level, 'ok'>; limit: Limit }
  | { kind: 'forecast'; limit: Limit; forecast: Extract<Forecast, { status: 'rising' }> };

const RANK: Record<Level, number> = { ok: 0, warn: 1, critical: 2, exhausted: 3 };

export function decideNotes(
  limits: Limit[],
  forecasts: Record<string, Forecast>,
  settings: Pick<Settings, 'warn' | 'critical' | 'notifications'>,
  store: NoteStore,
): { notes: Note[]; store: NoteStore } {
  const notes: Note[] = [];
  const next: NoteStore = {};
  for (const l of limits) {
    const cycle = cycleOf(l);
    const prev = store[l.id]?.cycle === cycle ? store[l.id] : undefined;
    const announced: Level = prev?.level ?? 'ok';
    const level = levelOf(l, settings.warn, settings.critical);
    const state: NoteState = { cycle, level: RANK[level] > RANK[announced] ? level : announced, forecast: prev?.forecast ?? false };
    // Only the highest new level is announced, so a jump from 10 % to used up shows one notification, not three.
    if (level !== 'ok' && RANK[level] > RANK[announced]) notes.push({ kind: 'threshold', level, limit: l });
    const f = forecasts[l.id];
    if (f?.status === 'rising' && f.beforeReset && !state.forecast && level !== 'exhausted') {
      notes.push({ kind: 'forecast', limit: l, forecast: f });
      state.forecast = true;
    }
    next[l.id] = state;
  }
  // When notifications are off the store still advances, so turning them on later does not replay old thresholds.
  return { notes: settings.notifications ? notes : [], store: next };
}
