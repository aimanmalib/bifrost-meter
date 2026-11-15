// One short line for a terminal status line (an agent's status line, tmux, a shell prompt). Pure: a quota reading in, text out.
// It shows the limit closest to running out, with the same words and rounding as the editor status bar.

import { formatPercent, normalize, strictest, type Language, type QuotaResult, type Translate } from '../core';
import { errorStateId } from '../extension/state';
import { remainingText, resetIn, withScope } from '../extension/view';

export interface Line {
  text: string;
  /** False when the gateway could not be read or no key is set. */
  ok: boolean;
}

export function statusLine(result: QuotaResult, now: number, t: Translate, lang: Language): Line {
  if (result.kind === 'noKey') return { text: t('cli.line', t('state.unconfigured')), ok: false };
  if (result.kind !== 'ok') return { text: t('cli.line', t(`state.${errorStateId(result)}`)), ok: false };
  const snapshot = normalize(result.quota, now);
  if (!snapshot.isActive) return { text: t('cli.line', t('state.inactive')), ok: true };
  const top = strictest(snapshot.limits);
  if (!top) return { text: t('cli.line', t('state.noLimit')), ok: true };
  const reset = resetIn(top, { t, now });
  if (top.remaining <= 0 || top.percent >= 100) {
    const used = t(`status.exhausted.${top.kind}`);
    return { text: t('cli.line', withScope(reset ? t('status.exhaustedReset', used, reset) : used, top, t)), ok: true };
  }
  const pct = formatPercent(top.percent, lang, t);
  const left = remainingText(top, { t, lang });
  const text = reset ? t('status.full', pct, left, reset) : t('status.noReset', pct, left);
  return { text: t('cli.line', withScope(text, top, t)), ok: true };
}
