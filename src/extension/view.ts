// Status bar text, icon, background and accessibility label for every display state. Pure; texts come from the bundle.

import { formatCount, formatDuration, formatPercent, formatUsd, type Language, type Limit, type Translate } from '../core';
import type { Settings } from './settings';
import { headline, stateId, type MeterState, type StateId } from './state';

export type Background = 'warning' | 'error' | undefined;

export interface StatusView {
  id: StateId;
  /** Codicon name without the `$()` wrapper. */
  icon: string;
  text: string;
  accessibility: string;
  background: Background;
}

export interface Ctx {
  t: Translate;
  lang: Language;
  now: number;
  settings: Settings;
}

const ICON: Record<StateId, string> = {
  unconfigured: 'key',
  loading: 'loading~spin',
  ok: 'dashboard',
  warn: 'warning',
  critical: 'error',
  exhausted: 'circle-slash',
  inactive: 'circle-slash',
  unauthorized: 'lock',
  forbidden: 'lock',
  expired: 'lock',
  offline: 'debug-disconnect',
  oldGateway: 'question',
  unexpected: 'question',
  noLimit: 'dashboard',
  insecure: 'lock',
  invalidUrl: 'question',
  redirect: 'question',
  http: 'question',
};

const BACKGROUND: Partial<Record<StateId, Background>> = {
  warn: 'warning',
  critical: 'error',
  exhausted: 'error',
  inactive: 'warning',
  unauthorized: 'error',
  forbidden: 'error',
  expired: 'error',
  oldGateway: 'warning',
  unexpected: 'warning',
  insecure: 'warning',
  invalidUrl: 'warning',
  redirect: 'warning',
  http: 'warning',
};

/** Remaining amount in the limit's own unit, rounded down so it never promises more than is left. */
export function remainingText(l: Limit, c: Pick<Ctx, 't' | 'lang'>): string {
  if (l.kind === 'budget') return formatUsd(l.remaining, c.lang, 'floor');
  return c.t(`unit.${l.kind}`, formatCount(l.remaining, c.lang, c.t, 'floor'));
}

export function usedOfText(l: Limit, c: Pick<Ctx, 't' | 'lang'>): string {
  const fmt = (v: number, mode: 'floor' | 'ceil'): string =>
    l.kind === 'budget' ? formatUsd(v, c.lang, mode) : formatCount(v, c.lang, c.t, mode);
  return c.t('limit.usedOf', fmt(l.used, 'ceil'), fmt(l.limit, 'floor'));
}

/** Countdown to the next reset, or undefined when the reset time is unknown or already passed. */
export function resetIn(l: Limit, c: Pick<Ctx, 't' | 'now'>): string | undefined {
  if (l.nextReset === null || l.nextReset <= c.now) return undefined;
  return formatDuration(l.nextReset - c.now, c.t);
}

/** "Budget", "Tokens" or "Requests", with the provider or model for scoped limits. */
export function limitLabel(l: Limit, t: Translate): string {
  const kind = t(`kind.${l.kind}`);
  return l.scope === 'key' || !l.scopeLabel ? kind : t(`scope.${l.scope}`, kind, l.scopeLabel);
}

const SCOPE_MAX = 20;

/** Provider or model name short enough for a status line: the part after the last "/", cut to SCOPE_MAX characters. */
export function shortScope(label: string): string {
  const name = label.slice(label.lastIndexOf('/') + 1) || label;
  return name.length > SCOPE_MAX ? `${name.slice(0, SCOPE_MAX - 1)}…` : name;
}

/** Adds the provider or model name to a status text when the limit is not the key's own; key limits are left as they are. */
export function withScope(text: string, l: Limit, t: Translate): string {
  return l.scope === 'key' || !l.scopeLabel ? text : t('status.scoped', text, shortScope(l.scopeLabel));
}

function limitView(id: StateId, l: Limit, c: Ctx): { text: string; accessibility: string } {
  const pct = formatPercent(l.percent, c.lang, c.t);
  const left = remainingText(l, c);
  const reset = resetIn(l, c);
  const label = limitLabel(l, c.t);
  let text: string;
  if (id === 'exhausted') {
    text = reset ? c.t('status.exhaustedReset', c.t(`status.exhausted.${l.kind}`), reset) : c.t(`status.exhausted.${l.kind}`);
  } else if (c.settings.format === 'percent') {
    text = pct;
  } else if (c.settings.format === 'compact' || !reset) {
    text = c.t(c.settings.format === 'compact' ? 'status.compact' : 'status.noReset', pct, left);
  } else {
    text = c.t('status.full', pct, left, reset);
  }
  const level = c.t(`level.${id}`);
  const detail = reset ? c.t('a11y.limitReset', label, pct, left, reset) : c.t('a11y.limit', label, pct, left);
  return { text: withScope(text, l, c.t), accessibility: c.t('a11y.prefix', `${level}. ${detail}`) };
}

export function statusView(state: MeterState, c: Ctx): StatusView {
  const id = stateId(state, c.settings);
  const base = { id, icon: ICON[id], background: BACKGROUND[id] };
  if (state.kind === 'ready' && id !== 'inactive' && id !== 'noLimit') {
    const top = headline(state, c.settings);
    if (top) return { ...base, ...limitView(id, top, c) };
  }
  const text = c.t(`state.${id}`);
  return { ...base, text, accessibility: c.t('a11y.prefix', detailText(state, c)) };
}

/** One sentence that says what happened and what to do, with the values that matter (status code, field, host). */
export function detailText(state: MeterState, c: Pick<Ctx, 't' | 'settings'>): string {
  const id = stateId(state, c.settings);
  if (state.kind !== 'error') return c.t(`state.${id}.detail`);
  const r = state.result;
  switch (r.kind) {
    case 'http':
      return c.t('state.http.detail', r.status);
    case 'schema':
      return c.t('state.unexpected.detail', r.field);
    case 'insecure':
      return c.t('state.insecure.detail', r.host);
    case 'redirect':
      return c.t('state.redirect.detail', hostOf(r.to));
    default:
      return c.t(`state.${id}.detail`);
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
};
