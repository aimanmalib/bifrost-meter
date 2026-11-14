// Tooltip (Markdown with command links) and the plain-text summary for Copy Summary. Pure.

import { formatClock, formatDuration, formatPercent, redactKey, type Forecast, type Limit } from '../core';
import { headline, stateId, type MeterState, type Reading, type StateId } from './state';
import { detailText, limitLabel, remainingText, resetIn, usedOfText, type Ctx } from './view';

export const COMMAND = {
  setKey: 'bifrostMeter.setKey',
  clearKey: 'bifrostMeter.clearKey',
  setBaseUrl: 'bifrostMeter.setBaseUrl',
  refresh: 'bifrostMeter.refresh',
  openDetails: 'bifrostMeter.openDetails',
  copySummary: 'bifrostMeter.copySummary',
  showLog: 'bifrostMeter.showLog',
} as const;

export interface TooltipInput {
  state: MeterState;
  /** The key in use, only ever shown as its last four characters. */
  key: string | undefined;
  baseUrl: string;
}

/** Escapes text from the gateway (key names, model names) so it cannot inject Markdown or links. */
export function md(text: string): string {
  return text.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, (ch) => `\\${ch}`);
}

const link = (label: string, command: string): string => `[${md(label)}](command:${command})`;

/** The action that fixes each problem state. */
const ACTION: Partial<Record<StateId, keyof typeof COMMAND>> = {
  unconfigured: 'setKey',
  unauthorized: 'setKey',
  forbidden: 'setKey',
  expired: 'setKey',
  insecure: 'setBaseUrl',
  invalidUrl: 'setBaseUrl',
  redirect: 'setBaseUrl',
  oldGateway: 'setBaseUrl',
};

/** "Runs out around 15:40, 2h before the reset", only when the forecast says the limit runs out before it resets. */
export function forecastText(f: Forecast | undefined, c: Ctx): string | undefined {
  if (!f || f.status !== 'rising' || !f.beforeReset) return undefined;
  return c.t('forecast.beforeReset', formatClock(f.exhaustAt, c.lang), formatDuration(f.leadMs, c.t));
}

function table(r: Reading, c: Ctx): string[] {
  if (r.snapshot.limits.length === 0) return [c.t('state.noLimit.detail')];
  const rows = r.snapshot.limits.map((l: Limit) => {
    const cells = [limitLabel(l, c.t), usedOfText(l, c), formatPercent(l.percent, c.lang, c.t), remainingText(l, c),
      resetIn(l, c) ?? l.resetRaw ?? c.t('reset.unknown')];
    return `| ${cells.map(md).join(' | ')} |`;
  });
  const head = ['col.limit', 'col.used', 'col.percent', 'col.left', 'col.reset'].map((k) => c.t(k));
  return [`| ${head.map(md).join(' | ')} |`, '|:--|--:|--:|--:|--:|', ...rows];
}

export function tooltipMarkdown(input: TooltipInput, c: Ctx): string {
  const { state } = input;
  const id = stateId(state, c.settings);
  const lines: string[] = [];
  const keyPart = input.key ? ` · ${md(c.t('tooltip.key', redactKey(input.key)))}` : '';
  lines.push(`**${md(c.t('tooltip.title'))}**${keyPart}`, '');

  const reading = state.kind === 'ready' ? state : state.kind === 'error' ? state.last : undefined;
  if (state.kind !== 'ready') lines.push(md(detailText(state, c)), '');
  if (reading) {
    lines.push(md(c.t('tooltip.keyName', reading.snapshot.keyName)), '');
    if (!reading.snapshot.isActive) lines.push(md(c.t('state.inactive.detail')), '');
    lines.push(...table(reading, c), '');
    const top = headline(reading, c.settings);
    const fc = top ? forecastText(reading.forecasts[top.id], c) : undefined;
    if (fc) lines.push(`$(watch) ${md(fc)}`, '');
    const stale = state.kind === 'error' ? 'tooltip.lastKnown' : 'tooltip.updated';
    lines.push(md(c.t(stale, formatClock(reading.at, c.lang))), '');
  }

  const actions = [link(c.t('action.refresh'), COMMAND.refresh), link(c.t('action.openDetails'), COMMAND.openDetails)];
  const fix = ACTION[id];
  if (fix) actions.unshift(link(c.t(`action.${fix}`), COMMAND[fix]));
  lines.push(actions.join(' · '), '', md(c.t('tooltip.gateway', input.baseUrl)));
  return lines.join('\n');
}

/** Plain text for the clipboard: one line per limit, no key. */
export function summaryText(input: TooltipInput, c: Ctx): string {
  const { state } = input;
  if (state.kind !== 'ready') return `${c.t('tooltip.title')}: ${detailText(state, c)}`;
  const out = [`${c.t('tooltip.title')}: ${state.snapshot.keyName}`];
  if (!state.snapshot.isActive) out.push(c.t('state.inactive.detail'));
  if (state.snapshot.limits.length === 0) out.push(c.t('state.noLimit.detail'));
  for (const l of state.snapshot.limits) {
    const reset = resetIn(l, c);
    const parts = [limitLabel(l, c.t), usedOfText(l, c), formatPercent(l.percent, c.lang, c.t), c.t('summary.left', remainingText(l, c))];
    if (reset) parts.push(c.t('summary.reset', reset));
    out.push(`- ${parts.join(', ')}`);
    const fc = forecastText(state.forecasts[l.id], c);
    if (fc) out.push(`  ${fc}`);
  }
  out.push(c.t('tooltip.updated', formatClock(state.at, c.lang)));
  return out.join('\n');
}
