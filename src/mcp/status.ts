// Turns one quota reading into the get_budget_status result: structured facts plus a short text summary. Pure: the server
// passes the reading, the clock and the sample store, and keeps the returned store for the next call.

import { formatDuration, formatPercent, MIN_SPAN_MS, normalize, redactKey, type Forecast, type Limit, type QuotaResult, type Translate } from '../core';
import { trackForecasts, type SeriesStore } from '../extension/forecasts';
import { limitLabel, remainingText, resetIn, usedOfText } from '../extension/view';
import type { McpConfig } from './config';

export type ForecastStatus = 'insufficient_data' | 'steady' | 'rising' | 'exhausted';

export interface LimitStatus {
  kind: Limit['kind'];
  scope: Limit['scope'];
  scope_label: string | null;
  unit: 'usd' | 'tokens' | 'requests';
  limit: number;
  used: number;
  remaining: number;
  /** used / limit × 100, two decimals; null when the limit is zero and something was used. */
  percent: number | null;
  is_exhausted: boolean;
  reset_period: string | null;
  resets_at: string | null;
  forecast: ForecastStatus;
  exhausts_at: string | null;
  /** True or false once the forecast has enough readings; null before that, and for limits already used up. */
  will_exhaust_before_reset: boolean | null;
}

export interface BudgetStatus {
  read_at: string;
  gateway: string;
  key_name: string;
  key_hint: string;
  is_active: boolean;
  /** The key's calendar_aligned setting, or null when the gateway does not report it (v2.5.1 and older). */
  calendar_aligned: boolean | null;
  is_exhausted: boolean;
  will_exhaust_before_reset: boolean | null;
  limits: LimitStatus[];
}

export type StatusOutcome =
  | { ok: true; status: BudgetStatus; text: string; store: SeriesStore }
  | { ok: false; error: { kind: string; status: number | null; message: string }; text: string; store: SeriesStore };

const iso = (ms: number | null): string | null => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());
const UNIT = { budget: 'usd', tokens: 'tokens', requests: 'requests' } as const;

const FORECAST: Record<Forecast['status'], ForecastStatus> = {
  insufficient: 'insufficient_data',
  steady: 'steady',
  rising: 'rising',
  exhausted: 'exhausted',
};

function limitStatus(l: Limit, f: Forecast): LimitStatus {
  const exhausted = l.remaining <= 0;
  let before: boolean | null = null;
  if (!exhausted && f.status === 'steady') before = false;
  if (!exhausted && f.status === 'rising') before = f.beforeReset;
  return {
    kind: l.kind,
    scope: l.scope,
    scope_label: l.scopeLabel ?? null,
    unit: UNIT[l.kind],
    limit: l.limit,
    used: l.used,
    remaining: l.remaining,
    percent: Number.isFinite(l.percent) ? Math.round(l.percent * 100) / 100 : null,
    is_exhausted: exhausted,
    reset_period: l.resetRaw ?? null,
    resets_at: iso(l.nextReset),
    forecast: exhausted ? 'exhausted' : FORECAST[f.status],
    exhausts_at: f.status === 'rising' ? iso(f.exhaustAt) : null,
    will_exhaust_before_reset: before,
  };
}

/** Any true wins; all known and false gives false; otherwise not known yet. */
function overall(limits: LimitStatus[]): boolean | null {
  const open = limits.filter((l) => !l.is_exhausted);
  if (open.some((l) => l.will_exhaust_before_reset === true)) return true;
  return open.every((l) => l.will_exhaust_before_reset === false) ? false : null;
}

function errorText(r: Exclude<QuotaResult, { kind: 'ok' }>, t: Translate): { kind: string; status: number | null; message: string } {
  const status = 'status' in r ? r.status : null;
  const state = (id: string, ...args: (string | number)[]): string => `${t(`state.${id}`)}. ${t(`state.${id}.detail`, ...args)}`;
  let message: string;
  switch (r.kind) {
    case 'noKey':
      message = t('mcp.error.noKey');
      break;
    case 'insecure':
      message = t('mcp.error.insecure', r.host);
      break;
    case 'unauthorized':
      message = state('unauthorized');
      break;
    case 'forbidden':
      message = state(r.expired ? 'expired' : 'forbidden');
      break;
    case 'notFound':
      message = state('oldGateway');
      break;
    case 'http':
      message = state('http', r.status);
      break;
    case 'schema':
      message = state('unexpected', r.field);
      break;
    case 'redirect':
      message = state('redirect', r.to);
      break;
    case 'invalidUrl':
      message = state('invalidUrl');
      break;
    case 'timeout':
    case 'offline':
      message = state('offline');
      break;
  }
  return { kind: r.kind, status, message: t('mcp.error', message) };
}

export function budgetStatus(result: QuotaResult, cfg: McpConfig, now: number, store: SeriesStore, t: Translate): StatusOutcome {
  if (result.kind !== 'ok') {
    const error = errorText(result, t);
    return { ok: false, error, text: error.message, store };
  }
  const snap = normalize(result.quota, now);
  const tracked = trackForecasts(store, snap.limits, now, cfg.forecastWindowMinutes);
  const limits = snap.limits.map((l) => limitStatus(l, tracked.forecasts[l.id] ?? { status: 'insufficient' }));
  const status: BudgetStatus = {
    read_at: new Date(now).toISOString(),
    gateway: cfg.baseUrl,
    key_name: snap.keyName,
    key_hint: redactKey(cfg.key),
    is_active: snap.isActive,
    calendar_aligned: snap.calendarAligned ?? null,
    is_exhausted: limits.some((l) => l.is_exhausted),
    will_exhaust_before_reset: overall(limits),
    limits,
  };

  const c = { t, lang: cfg.lang, now };
  const lines = [t('mcp.text.head', snap.keyName, status.key_hint, status.read_at)];
  if (!snap.isActive) lines.push(t('state.inactive.detail'));
  if (snap.limits.length === 0) lines.push(t('state.noLimit.detail'));
  snap.limits.forEach((l, i) => {
    const reset = resetIn(l, c);
    lines.push(
      t(
        'mcp.text.limit',
        limitLabel(l, t),
        usedOfText(l, c),
        formatPercent(l.percent, cfg.lang, t),
        t('summary.left', remainingText(l, c)),
        reset ? t('summary.reset', reset) : t('mcp.text.resetUnknown'),
      ),
    );
    const s = limits[i];
    if (s?.is_exhausted) lines.push(t('mcp.text.exhausted', limitLabel(l, t)));
    else if (s?.will_exhaust_before_reset && s.exhausts_at) lines.push(t('mcp.text.forecast', limitLabel(l, t), s.exhausts_at));
  });
  if (limits.some((l) => l.forecast === 'insufficient_data')) lines.push(t('mcp.text.noForecast', formatDuration(MIN_SPAN_MS, t)));
  return { ok: true, status, text: lines.join('\n'), store: tracked.store };
}
