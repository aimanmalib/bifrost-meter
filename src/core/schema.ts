// Shape check for GET /api/governance/virtual-keys/quota. Unknown fields are ignored; a missing or mistyped required field
// is reported by name so the user sees "unexpected response (field)" instead of a silent zero.

export interface RawBudget {
  id?: string;
  max_limit: number;
  current_usage: number;
  reset_duration?: string;
  last_reset?: string;
  calendar_aligned?: boolean;
  /** Extra amount an admin granted on top of max_limit (budget override). */
  override_amount?: number;
  /** "forever", or "cycles" together with override_cycles_remaining. */
  override_mode?: string;
  override_cycles_remaining?: number;
  per_model_usage?: RawModelUsage[];
}

export interface RawModelUsage {
  model?: string;
  model_name?: string;
  provider?: string;
  /** Spend in USD since the budget's last reset; the field the gateway sends. */
  total_cost?: number;
  total_requests?: number;
  total_tokens?: number;
  /** Older or alternative names, read only when total_cost is absent. */
  current_usage?: number;
  usage?: number;
}

export interface RawRateLimit {
  id?: string;
  token_max_limit?: number | null;
  token_current_usage?: number | null;
  token_reset_duration?: string | null;
  token_last_reset?: string | null;
  request_max_limit?: number | null;
  request_current_usage?: number | null;
  request_reset_duration?: string | null;
  request_last_reset?: string | null;
}

/** A provider or model entry that may carry its own budgets and rate limit. */
export interface RawScopedConfig {
  provider?: string;
  model_name?: string;
  model?: string;
  budgets?: RawBudget[];
  rate_limit?: RawRateLimit | null;
}

export interface QuotaResponse {
  virtual_key_name: string;
  is_active: boolean;
  budgets: RawBudget[];
  rate_limit: RawRateLimit | null;
  rate_limits: RawRateLimit[];
  provider_configs: RawScopedConfig[];
  model_configs: RawScopedConfig[];
}

export type SchemaResult = { ok: true; value: QuotaResponse } | { ok: false; field: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown): boolean => v === undefined || v === null || isNum(v);
const optStr = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';

class FieldError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

function budget(v: unknown, path: string): RawBudget {
  if (!isObj(v)) throw new FieldError(path);
  if (!isNum(v.max_limit)) throw new FieldError(`${path}.max_limit`);
  if (!isNum(v.current_usage)) throw new FieldError(`${path}.current_usage`);
  if (!optStr(v.reset_duration)) throw new FieldError(`${path}.reset_duration`);
  if (!optStr(v.last_reset)) throw new FieldError(`${path}.last_reset`);
  const pmu = Array.isArray(v.per_model_usage) ? v.per_model_usage.filter(isObj) : [];
  return {
    id: typeof v.id === 'string' ? v.id : undefined,
    max_limit: v.max_limit,
    current_usage: v.current_usage,
    reset_duration: typeof v.reset_duration === 'string' ? v.reset_duration : undefined,
    last_reset: typeof v.last_reset === 'string' ? v.last_reset : undefined,
    calendar_aligned: v.calendar_aligned === true,
    override_amount: isNum(v.override_amount) ? v.override_amount : undefined,
    override_mode: typeof v.override_mode === 'string' ? v.override_mode : undefined,
    override_cycles_remaining: isNum(v.override_cycles_remaining) ? v.override_cycles_remaining : undefined,
    per_model_usage: pmu as RawModelUsage[],
  };
}

const RATE_NUM = ['token_max_limit', 'token_current_usage', 'request_max_limit', 'request_current_usage'] as const;
const RATE_STR = ['token_reset_duration', 'token_last_reset', 'request_reset_duration', 'request_last_reset'] as const;

function rateLimit(v: unknown, path: string): RawRateLimit | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new FieldError(path);
  const out: RawRateLimit = { id: typeof v.id === 'string' ? v.id : undefined };
  for (const k of RATE_NUM) {
    if (!optNum(v[k])) throw new FieldError(`${path}.${k}`);
    out[k] = (v[k] as number | null | undefined) ?? null;
  }
  for (const k of RATE_STR) {
    if (!optStr(v[k])) throw new FieldError(`${path}.${k}`);
    out[k] = (v[k] as string | null | undefined) ?? null;
  }
  return out;
}

function scoped(v: unknown, path: string): RawScopedConfig | null {
  // Provider and model entries are informational; a malformed entry is skipped, not fatal.
  if (!isObj(v)) return null;
  try {
    return {
      provider: typeof v.provider === 'string' ? v.provider : undefined,
      model_name: typeof v.model_name === 'string' ? v.model_name : undefined,
      model: typeof v.model === 'string' ? v.model : undefined,
      budgets: Array.isArray(v.budgets) ? v.budgets.map((b, i) => budget(b, `${path}.budgets[${i}]`)) : [],
      rate_limit: rateLimit(v.rate_limit, `${path}.rate_limit`),
    };
  } catch {
    return null;
  }
}

function list<T>(v: unknown, path: string, item: (x: unknown, p: string) => T | null): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new FieldError(path);
  return v.map((x, i) => item(x, `${path}[${i}]`)).filter((x): x is T => x !== null);
}

export function parseQuota(body: unknown): SchemaResult {
  try {
    if (!isObj(body)) throw new FieldError('(body)');
    if (typeof body.virtual_key_name !== 'string') throw new FieldError('virtual_key_name');
    if (typeof body.is_active !== 'boolean') throw new FieldError('is_active');
    if (!Array.isArray(body.budgets)) throw new FieldError('budgets');
    return {
      ok: true,
      value: {
        virtual_key_name: body.virtual_key_name,
        is_active: body.is_active,
        budgets: body.budgets.map((b, i) => budget(b, `budgets[${i}]`)),
        rate_limit: rateLimit(body.rate_limit, 'rate_limit'),
        rate_limits: list(body.rate_limits, 'rate_limits', rateLimit),
        provider_configs: list(body.provider_configs, 'provider_configs', scoped),
        model_configs: list(body.model_configs, 'model_configs', scoped),
      },
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, field: e.field };
    throw e;
  }
}

/** Reads `error.message` from a Bifrost error body, or undefined. Never echoes anything else from the body. */
export function errorMessage(body: unknown): string | undefined {
  if (!isObj(body) || !isObj(body.error)) return undefined;
  return typeof body.error.message === 'string' ? body.error.message : undefined;
}
