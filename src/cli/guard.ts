// `guard`: a pre-check for CI steps and coding agents. Pure: a quota reading and a minimum share left in, an exit code and
// one sentence out. 0 = go, 2 = stop (the key is inactive, or the limit closest to running out has less left than asked),
// 1 = the gateway could not be read or the arguments are wrong. The sentence never contains the key.

import { formatPercent, normalize, strictest, type Language, type QuotaResult, type Translate } from '../core';
import { errorStateId } from '../extension/state';
import { limitText } from './line';

export const GUARD_GO = 0;
export const GUARD_ERROR = 1;
export const GUARD_STOP = 2;

export interface GuardOutcome {
  code: typeof GUARD_GO | typeof GUARD_ERROR | typeof GUARD_STOP;
  text: string;
}

/** Reads `--min-remaining <n>` or `--min-remaining=<n>` (percent of the limit still left, 0 to 100). Absent = 0: stop only when used up. */
export function parseMinRemaining(argv: string[]): { ok: true; value: number } | { ok: false; raw: string } {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--min-remaining') raw = argv[i + 1] ?? '';
    else if (a.startsWith('--min-remaining=')) raw = a.slice('--min-remaining='.length);
  }
  if (raw === undefined) return { ok: true, value: 0 };
  const value = raw.trim() === '' ? NaN : Number(raw.replace(/%$/, ''));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? { ok: true, value } : { ok: false, raw };
}

export function guard(result: QuotaResult, minRemaining: number, now: number, t: Translate, lang: Language): GuardOutcome {
  if (result.kind === 'noKey') return { code: GUARD_ERROR, text: t('cli.guard.noKey') };
  if (result.kind !== 'ok') return { code: GUARD_ERROR, text: t('cli.guard.error', t(`state.${errorStateId(result)}`)) };
  const snapshot = normalize(result.quota, now);
  if (!snapshot.isActive) return { code: GUARD_STOP, text: t('cli.guard.stopState', t('state.inactive')) };
  const top = strictest(snapshot.limits);
  if (!top) return { code: GUARD_GO, text: t('cli.guard.goState', t('state.noLimit')) };
  const needed = formatPercent(minRemaining, lang, t);
  // The tolerance keeps 80.000000001% used from reading as less than 20% left.
  const stop = top.remaining <= 0 || top.percent >= 100 || 100 - top.percent + 1e-9 < minRemaining;
  return { code: stop ? GUARD_STOP : GUARD_GO, text: t(stop ? 'cli.guard.stop' : 'cli.guard.go', limitText(top, now, t, lang), needed) };
}
