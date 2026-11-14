// HTML for the details panel (webview). Pure: the extension passes the state, the stored samples and a fresh nonce.
// Every string from the gateway or the bundle is escaped; nothing loads from outside; the key shows as its last 4 characters.

import { formatClock, formatPercent, formatUsd, levelOf, redactKey, type Limit, type Series } from '../core';
import { barSvg, chartSvg } from './chart';
import { headline, stateId, type MeterState, type Reading, type StateId } from './state';
import { COMMAND, forecastText } from './tooltip';
import { detailText, limitLabel, remainingText, resetIn, usedOfText, type Ctx } from './view';
import { PANEL_STYLE } from './panelStyle';

export interface PanelInput {
  state: MeterState;
  key: string | undefined;
  baseUrl: string;
  /** Gateway version from /api/version, when it could be read. */
  version: string | undefined;
  /** Usage samples per limit id (the same store the forecast uses). */
  series: Record<string, Series>;
}

export interface PanelEnv {
  /** Fresh per render; the only style and script blocks carry it. */
  nonce: string;
}

/** The commands a button in the panel may run. Anything else the webview posts is ignored. */
export const PANEL_ACTIONS = ['refresh', 'setKey', 'setBaseUrl', 'copySummary', 'showLog'] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

export function panelCommand(message: unknown): string | undefined {
  const action = (message as { action?: unknown } | null)?.action;
  return PANEL_ACTIONS.includes(action as PanelAction) ? COMMAND[action as PanelAction] : undefined;
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The action that fixes each problem state (same mapping as the tooltip). */
const FIX: Partial<Record<StateId, PanelAction>> = {
  unconfigured: 'setKey',
  unauthorized: 'setKey',
  forbidden: 'setKey',
  expired: 'setKey',
  insecure: 'setBaseUrl',
  invalidUrl: 'setBaseUrl',
  redirect: 'setBaseUrl',
  oldGateway: 'setBaseUrl',
  offline: 'refresh',
};

const button = (action: PanelAction, c: Ctx, primary = false): string =>
  `<button type="button" data-action="${action}"${primary ? ' class="primary"' : ''}>${esc(c.t(`action.${action}`))}</button>`;

function limitBlock(l: Limit, r: Reading, c: Ctx): string {
  const level = levelOf(l, c.settings.warn, c.settings.critical);
  const label = limitLabel(l, c.t);
  const pct = formatPercent(l.percent, c.lang, c.t);
  const reset = resetIn(l, c);
  const fc = forecastText(r.forecasts[l.id], c);
  return (
    `<section class="limit lvl-${level}" aria-label="${esc(label)}">` +
    `<div class="row"><h3>${esc(label)}</h3><span class="level"><span class="swatch" aria-hidden="true"></span>${esc(c.t(`level.${level}`))}</span></div>` +
    `<div class="row num"><span>${esc(usedOfText(l, c))}</span><span>${esc(pct)}</span></div>` +
    barSvg(l.percent, level, c.settings.warn, c.settings.critical, esc(`${label} ${pct}`)) +
    `<div class="row num muted"><span>${esc(c.t('summary.left', remainingText(l, c)))}</span>` +
    `<span>${esc(reset ? c.t('summary.reset', reset) : l.resetRaw ?? c.t('reset.unknown'))}</span></div>` +
    (fc ? `<p class="forecast">${esc(fc)}</p>` : '') +
    `</section>`
  );
}

function chartBlock(r: Reading, input: PanelInput, c: Ctx): string {
  const top = headline(r, c.settings);
  const samples = top ? (input.series[top.id]?.samples ?? []) : [];
  if (!top || samples.length < 2) return '';
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const fmt = (v: number): string => (top.kind === 'budget' ? formatUsd(v, c.lang, 'ceil') : String(Math.ceil(v)));
  const from = formatClock(first.t, c.lang);
  const to = formatClock(last.t, c.lang);
  const summary = c.t('panel.chart.summary', fmt(first.used), from, fmt(last.used), to);
  return (
    `<section class="usage" aria-labelledby="chart-h"><h2 id="chart-h">${esc(c.t('panel.chart.title', limitLabel(top, c.t)))}</h2>` +
    chartSvg(samples, top, esc(summary)) +
    `<div class="row num muted"><span>${esc(from)}</span><span>${esc(c.t('panel.chart.limitLine'))}</span><span>${esc(to)}</span></div>` +
    `</section>`
  );
}

function spendBlock(r: Reading, c: Ctx): string {
  const rows = r.snapshot.modelSpend
    .map((m) => `<tr><th scope="row">${esc(m.model)}</th><td class="num">${esc(formatUsd(m.usd, c.lang, 'ceil'))}</td></tr>`)
    .join('');
  const body = rows ? `<table>${rows}</table>` : `<p class="muted">${esc(c.t('panel.spend.empty'))}</p>`;
  return `<section class="spend" aria-labelledby="spend-h"><h2 id="spend-h">${esc(c.t('panel.spend.title'))}</h2>${body}</section>`;
}

function body(input: PanelInput, c: Ctx): string {
  const { state } = input;
  const id = stateId(state, c.settings);
  const reading = state.kind === 'ready' ? state : state.kind === 'error' ? state.last : undefined;
  const out: string[] = [];

  const keyBits: string[] = [];
  if (reading) keyBits.push(`<span class="key-name">${esc(reading.snapshot.keyName)}</span>`);
  if (input.key) keyBits.push(`<span>${esc(c.t('tooltip.key', redactKey(input.key)))}</span>`);
  if (reading) keyBits.push(`<span>${esc(reading.snapshot.isActive ? c.t('panel.active') : c.t('state.inactive'))}</span>`);
  out.push(
    `<header><div class="row"><h1>${esc(c.t('tooltip.title'))}</h1>${button('refresh', c)}</div>` +
      (keyBits.length ? `<p class="keyline">${keyBits.join('')}</p>` : '') +
      `</header>`,
  );

  const notice = state.kind !== 'ready' || id === 'inactive' || id === 'noLimit';
  const fix = notice ? FIX[id] : undefined;
  if (notice) {
    const problem = state.kind === 'error' || id === 'inactive' || id === 'unconfigured';
    out.push(
      `<div class="notice${problem ? ' problem' : ''}" role="${problem ? 'alert' : 'status'}"><p>${esc(detailText(state, c))}</p>` +
        (fix && fix !== 'refresh' ? button(fix, c, true) : '') +
        `</div>`,
    );
  }

  if (reading) {
    if (state.kind === 'error') out.push(`<p class="muted">${esc(c.t('tooltip.lastKnown', formatClock(reading.at, c.lang)))}</p>`);
    const limits = reading.snapshot.limits;
    if (limits.length) {
      out.push(`<h2 class="sr">${esc(c.t('panel.limits'))}</h2>`, ...limits.map((l) => limitBlock(l, reading, c)));
    }
    out.push(chartBlock(reading, input, c), spendBlock(reading, c));
  }

  const version = input.version ? c.t('panel.version', input.version) : c.t('panel.versionUnknown');
  const updated = state.kind === 'ready' ? `<p class="muted">${esc(c.t('tooltip.updated', formatClock(state.at, c.lang)))}</p>` : '';
  out.push(
    `<footer><dl><dt>${esc(c.t('panel.gateway'))}</dt><dd><span class="url">${esc(input.baseUrl)}</span> <span class="muted">${esc(version)}</span></dd></dl>` +
      updated +
      // The action already offered as the fix above is not repeated here.
      `<div class="actions">${(['setKey', 'setBaseUrl', 'copySummary', 'showLog'] as const).filter((a) => a !== fix).map((a) => button(a, c)).join('')}</div></footer>`,
  );
  return out.join('\n');
}

// Posts the clicked action, and keeps keyboard focus on the same button when the page is replaced after a refresh.
const SCRIPT = `const vscode = acquireVsCodeApi();
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button[data-action]') : null;
  if (b) vscode.postMessage({ action: b.getAttribute('data-action') });
});
document.addEventListener('focusin', (e) => {
  const a = e.target instanceof Element ? e.target.getAttribute('data-action') : null;
  vscode.setState({ focus: a });
});
const last = (vscode.getState() || {}).focus;
if (last && document.hasFocus()) document.querySelector('button[data-action="' + CSS.escape(last) + '"]')?.focus();`;

export function panelHtml(input: PanelInput, c: Ctx, env: PanelEnv): string {
  const nonce = esc(env.nonce);
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  return `<!DOCTYPE html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.t('tooltip.title'))}</title>
<style nonce="${nonce}">${PANEL_STYLE}</style>
</head>
<body>
<main>
${body(input, c)}
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
