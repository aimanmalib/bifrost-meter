// What the meter knows right now, and which of the named display states that is. Pure.

import type { Forecast, Level, Limit, QuotaResult, Snapshot } from '../core';
import { levelOf, strictest } from '../core';
import type { Settings } from './settings';

export interface Reading {
  snapshot: Snapshot;
  forecasts: Record<string, Forecast>;
  /** Epoch ms of the successful fetch. */
  at: number;
}

export type ErrorResult = Exclude<QuotaResult, { kind: 'ok' } | { kind: 'noKey' }>;

export type MeterState =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | ({ kind: 'ready' } & Reading)
  | { kind: 'error'; result: ErrorResult; at: number; last?: Reading };

/** The display states of the design brief (docs/DESIGN.md), plus the settings errors. */
export type StateId =
  | 'unconfigured'
  | 'loading'
  | 'ok'
  | 'warn'
  | 'critical'
  | 'exhausted'
  | 'inactive'
  | 'unauthorized'
  | 'forbidden'
  | 'expired'
  | 'offline'
  | 'oldGateway'
  | 'unexpected'
  | 'noLimit'
  | 'insecure'
  | 'invalidUrl'
  | 'redirect'
  | 'http';

/** Epoch ms of each rising forecast, used to break percent ties when picking the strictest limit. */
export function exhaustTimes(forecasts: Record<string, Forecast>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [id, f] of Object.entries(forecasts)) out[id] = f.status === 'rising' ? f.exhaustAt : null;
  return out;
}

export function headline(r: Reading, s: Settings): Limit | null {
  return strictest(r.snapshot.limits, s.metric, exhaustTimes(r.forecasts));
}

const LEVEL_STATE: Record<Level, StateId> = { ok: 'ok', warn: 'warn', critical: 'critical', exhausted: 'exhausted' };

export function stateId(state: MeterState, s: Settings): StateId {
  switch (state.kind) {
    case 'unconfigured':
    case 'loading':
      return state.kind;
    case 'ready': {
      if (!state.snapshot.isActive) return 'inactive';
      const top = headline(state, s);
      return top ? LEVEL_STATE[levelOf(top, s.warn, s.critical)] : 'noLimit';
    }
    case 'error':
      return errorStateId(state.result);
  }
}

export function errorStateId(r: ErrorResult): StateId {
  switch (r.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'forbidden':
      return r.expired ? 'expired' : 'forbidden';
    case 'notFound':
      return 'oldGateway';
    case 'schema':
      return 'unexpected';
    case 'timeout':
    case 'offline':
      return 'offline';
    case 'insecure':
    case 'invalidUrl':
    case 'redirect':
    case 'http':
      return r.kind;
  }
}
