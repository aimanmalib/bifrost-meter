// Turns a checked quota response into a flat list of limits that the status bar, tooltip, panel, MCP server and CLI share.

import { nextReset, parseDuration } from './duration';
import type { QuotaResponse, RawBudget, RawRateLimit, RawScopedConfig } from './schema';

export type LimitKind = 'budget' | 'tokens' | 'requests';
export type LimitScope = 'key' | 'provider' | 'model';
export type Metric = 'auto' | LimitKind;

export interface Limit {
  /** Stable within a key: used to keep forecast samples and notification state apart. */
  id: string;
  kind: LimitKind;
  scope: LimitScope;
  /** Provider or model name for scoped limits. */
  scopeLabel?: string;
  limit: number;
  used: number;
  remaining: number;
  /** used / limit × 100, not clamped (can exceed 100 when the gateway lets usage run over). */
  percent: number;
  /** Reset period exactly as the gateway sent it. */
  resetRaw?: string;
  /** Epoch ms of the next reset, or null when the period or last reset cannot be read. */
  nextReset: number | null;
  /** Epoch ms of the last reset (used to tell when a new cycle starts). */
  lastReset: number | null;
}

export interface Snapshot {
  keyName: string;
  isActive: boolean;
  limits: Limit[];
  /** Spend per model from the budgets, highest cost first. Empty when the gateway does not report it. */
  modelSpend: { model: string; usd: number }[];
}

const pct = (used: number, limit: number): number => (limit > 0 ? (used / limit) * 100 : used > 0 ? Infinity : 100);

function make(
  id: string,
  kind: LimitKind,
  scope: LimitScope,
  scopeLabel: string | undefined,
  limit: number,
  used: number,
  resetRaw: string | null | undefined,
  last: string | null | undefined,
  now: number,
): Limit {
  const lastMs = typeof last === 'string' ? Date.parse(last) : NaN;
  return {
    id,
    kind,
    scope,
    ...(scopeLabel ? { scopeLabel } : {}),
    limit,
    used,
    remaining: Math.max(0, limit - used),
    percent: pct(used, limit),
    ...(resetRaw ? { resetRaw } : {}),
    nextReset: nextReset(last, parseDuration(resetRaw), now),
    lastReset: Number.isFinite(lastMs) ? lastMs : null,
  };
}

function budgets(list: RawBudget[], scope: LimitScope, label: string | undefined, prefix: string, now: number): Limit[] {
  return list.map((b, i) =>
    make(`${prefix}budget:${b.id ?? i}`, 'budget', scope, label, b.max_limit, b.current_usage, b.reset_duration, b.last_reset, now),
  );
}

const isSet = (v: number | null | undefined): v is number => typeof v === 'number' && v > 0;

function rates(rl: RawRateLimit, scope: LimitScope, label: string | undefined, prefix: string, idx: number, now: number): Limit[] {
  const out: Limit[] = [];
  const base = `${prefix}rate:${rl.id ?? idx}`;
  if (isSet(rl.token_max_limit)) {
    out.push(make(`${base}:tokens`, 'tokens', scope, label, rl.token_max_limit, rl.token_current_usage ?? 0,
      rl.token_reset_duration, rl.token_last_reset, now));
  }
  if (isSet(rl.request_max_limit)) {
    out.push(make(`${base}:requests`, 'requests', scope, label, rl.request_max_limit, rl.request_current_usage ?? 0,
      rl.request_reset_duration, rl.request_last_reset, now));
  }
  return out;
}

function keyRateLimits(q: QuotaResponse): RawRateLimit[] {
  // `rate_limits` lists every key-level limit and `rate_limit` repeats the first; prefer the list, de-duplicate by id.
  const all = q.rate_limits.length > 0 ? q.rate_limits : q.rate_limit ? [q.rate_limit] : [];
  const seen = new Set<string>();
  return all.filter((r) => {
    if (!r.id) return true;
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function scopedLimits(list: RawScopedConfig[], scope: LimitScope, now: number): Limit[] {
  return list.flatMap((c, i) => {
    const label = scope === 'provider' ? c.provider : (c.model_name ?? c.model);
    const prefix = `${scope}:${label ?? i}:`;
    return [
      ...budgets(c.budgets ?? [], scope, label, prefix, now),
      ...(c.rate_limit ? rates(c.rate_limit, scope, label, prefix, 0, now) : []),
    ];
  });
}

function modelSpend(list: RawBudget[]): { model: string; usd: number }[] {
  const totals = new Map<string, number>();
  for (const b of list) {
    for (const u of b.per_model_usage ?? []) {
      const model = u.model ?? u.model_name;
      const usd = u.current_usage ?? u.usage;
      if (typeof model !== 'string' || typeof usd !== 'number' || !Number.isFinite(usd)) continue;
      totals.set(model, (totals.get(model) ?? 0) + usd);
    }
  }
  return [...totals].map(([model, usd]) => ({ model, usd })).sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model));
}

export function normalize(q: QuotaResponse, now: number): Snapshot {
  return {
    keyName: q.virtual_key_name,
    isActive: q.is_active,
    limits: [
      ...budgets(q.budgets, 'key', undefined, '', now),
      ...keyRateLimits(q).flatMap((r, i) => rates(r, 'key', undefined, '', i, now)),
      ...scopedLimits(q.provider_configs, 'provider', now),
      ...scopedLimits(q.model_configs, 'model', now),
    ],
    modelSpend: modelSpend(q.budgets),
  };
}

const KIND_ORDER: LimitKind[] = ['budget', 'tokens', 'requests'];

/**
 * The limit closest to running out: highest percent used; a tie goes to the one forecast to run out first, then budget before
 * tokens before requests. `metric` narrows the choice to one kind; when the key has no limit of that kind it falls back to
 * all limits. Returns null when the key has no limits at all ("no limit").
 */
export function strictest(limits: Limit[], metric: Metric = 'auto', exhaustAt: Record<string, number | null> = {}): Limit | null {
  const narrowed = metric === 'auto' ? limits : limits.filter((l) => l.kind === metric);
  const pool = narrowed.length > 0 ? narrowed : limits;
  let best: Limit | null = null;
  for (const l of pool) {
    if (!best) {
      best = l;
      continue;
    }
    if (l.percent !== best.percent) {
      if (l.percent > best.percent) best = l;
      continue;
    }
    const a = exhaustAt[l.id] ?? Infinity;
    const b = exhaustAt[best.id] ?? Infinity;
    if (a !== b) {
      if (a < b) best = l;
      continue;
    }
    if (KIND_ORDER.indexOf(l.kind) < KIND_ORDER.indexOf(best.kind)) best = l;
  }
  return best;
}

/** Threshold level for a percent value; thresholds are percents from settings (defaults 75 and 90). */
export type Level = 'ok' | 'warn' | 'critical' | 'exhausted';

export function levelOf(l: Pick<Limit, 'percent' | 'remaining'>, warn: number, critical: number): Level {
  if (l.remaining <= 0 || l.percent >= 100) return 'exhausted';
  if (l.percent >= critical) return 'critical';
  if (l.percent >= warn) return 'warn';
  return 'ok';
}
