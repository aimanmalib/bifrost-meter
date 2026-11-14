// Preview sheets: every status bar and panel state, rendered with the extension's own code, in dark, light and high contrast
// approximations, at a narrow (320 px) and a wide (520 px) panel width. WebKit takes the screenshots and checks that no
// panel scrolls sideways. Run with `npm run preview:states [out-dir]`; the default output folder is ignored by git.
//
// The sheets are for reviewing the design. Real-theme screenshots come from the end-to-end tests in code-server.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webkit } from '@playwright/test';
import type { Forecast, Language, Limit, Series } from '../../src/core';
import { translator } from '../../src/core';
import { panelHtml } from '../../src/extension/panelHtml';
import { readSettings } from '../../src/extension/settings';
import type { ErrorResult, MeterState, Reading } from '../../src/extension/state';
import { statusView, type Ctx } from '../../src/extension/view';

interface Theme {
  bodyClass: string;
  statusBar: { background: string; foreground: string; warning: string; error: string; border: string };
  vars: Record<string, string>;
}

const NOW = Date.parse('2026-11-14T15:00:00Z');
const HOUR = 3_600_000;
const NONCE = 'cHJldmlldy1zaGVldA==';
const WIDTHS = [320, 520];
const outDir = resolve(process.argv[2] ?? 'out/states');
const themes = JSON.parse(readFileSync(resolve('scripts/state-sheet.themes.json'), 'utf8')) as Record<string, Theme | string>;

const limit = (over: Partial<Limit> = {}): Limit => {
  const l: Limit = { id: 'budget:a', kind: 'budget', scope: 'key', limit: 10, used: 6.2, remaining: 3.8, percent: 62,
    resetRaw: '1d', nextReset: NOW + 4 * HOUR, lastReset: NOW - 20 * HOUR, ...over };
  l.remaining = Math.max(0, l.limit - l.used);
  l.percent = (l.used / l.limit) * 100;
  return l;
};
const rising: Forecast = { status: 'rising', ratePerHour: 1, exhaustAt: NOW + 2 * HOUR, beforeReset: true, leadMs: 2 * HOUR };
const reading = (used: number, over: Partial<Reading['snapshot']> = {}): Reading => ({
  at: NOW,
  forecasts: used < 10 ? { 'budget:a': rising } : { 'budget:a': { status: 'exhausted' } },
  snapshot: {
    keyName: 'demo-team-a',
    isActive: true,
    limits: [
      limit({ used }),
      limit({ id: 'rate:r:tokens', kind: 'tokens', limit: 50_000, used: 21_400, resetRaw: '1h', nextReset: NOW + 40 * 60_000 }),
      limit({ id: 'rate:r:requests', kind: 'requests', limit: 30, used: 12, resetRaw: '1m', nextReset: NOW + 30_000 }),
    ],
    modelSpend: [{ model: 'gpt-4o', usd: used * 0.7 }, { model: 'gpt-4o-mini', usd: used * 0.3 }],
    ...over,
  },
});
const ready = (used: number, over: Partial<Reading['snapshot']> = {}): MeterState => ({ kind: 'ready', ...reading(used, over) });
const error = (result: ErrorResult, last?: Reading): MeterState => ({ kind: 'error', result, at: NOW, ...(last ? { last } : {}) });

const STATES: [string, MeterState][] = [
  ['Not configured', { kind: 'unconfigured' }],
  ['Loading', { kind: 'loading' }],
  ['OK', ready(6.2)],
  ['Warning', ready(8.1)],
  ['Critical', ready(9.4)],
  ['Used up', ready(10)],
  ['Key inactive', ready(6.2, { isActive: false })],
  ['401 key rejected', error({ kind: 'unauthorized', status: 401 })],
  ['403 key expired', error({ kind: 'forbidden', status: 403, expired: true })],
  ['Offline', error({ kind: 'offline', reason: 'ECONNREFUSED' }, reading(6.2))],
  ['404 gateway too old', error({ kind: 'notFound', status: 404 })],
  ['Unexpected response', error({ kind: 'schema', field: 'budgets' })],
  ['No limits', ready(0, { limits: [], modelSpend: [] })],
  ['Plain http to a public host', error({ kind: 'insecure', host: 'gw.example.com' })],
];
const series: Record<string, Series> = {
  'budget:a': { cycle: 'c', samples: [0, 1.5, 3.1, 4.4, 6.2].map((used, i) => ({ t: NOW - (4 - i) * 10 * 60_000, used })) },
};

const ctx = (lang: Language): Ctx => ({ t: translator(lang), lang, now: NOW, settings: readSettings(() => undefined) });
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function themedPanel(state: MeterState, theme: Theme, lang: Language): string {
  const html = panelHtml({ state, key: ['sk', 'bf', 'x'.repeat(12) + 'a1b2'].join('-'), baseUrl: 'http://localhost:8080',
    version: 'v2.5.1', series }, ctx(lang), { nonce: NONCE });
  const vars = Object.entries(theme.vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  const base = `html { --vscode-font-family: system-ui, sans-serif; --vscode-font-size: 13px; ` +
    `--vscode-editor-font-family: ui-monospace, monospace; ${vars} } body { margin: 0; background: var(--vscode-editor-background); }`;
  return html
    .replace('<head>', `<head><style nonce="${NONCE}">${base}</style>`)
    .replace('<body>', `<body class="${theme.bodyClass}">`);
}

function sheet(name: string, theme: Theme, lang: Language, shots: string[]): string {
  const sb = theme.statusBar;
  const cards = STATES.map(([label, state], i) => {
    const v = statusView(state, ctx(lang));
    const bg = v.background === 'warning' ? sb.warning : v.background === 'error' ? sb.error : sb.background;
    return `<figure><figcaption>${esc(label)}</figcaption>` +
      `<div class="sb" style="background:${bg};color:${sb.foreground};border-color:${sb.border}"><span class="ic">$(${esc(v.icon)})</span> ${esc(v.text)}</div>` +
      `<img src="${shots[i]}" width="320"></figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #808080; font: 12px system-ui, sans-serif; width: ${5 * 336}px; }
    h1 { font-size: 14px; margin: 0 0 12px; } main { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    figure { margin: 0; width: 320px; } figcaption { font-weight: 600; margin-bottom: 4px; }
    .sb { font: 12px system-ui, sans-serif; padding: 3px 8px; border-top: 1px solid; white-space: nowrap; overflow: hidden; }
    .ic { opacity: .7; font-family: ui-monospace, monospace; } img { display: block; border: 1px solid #0003; }
  </style><h1>Bifrost Meter states, ${esc(name)} (${lang}), panel 320 px</h1><main>${cards}</main>`;
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await webkit.launch();
  const overflow: string[] = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const runs: [string, Language][] = [['dark', 'en'], ['light', 'en'], ['high-contrast', 'en'], ['dark', 'ms']];
    for (const [name, lang] of runs) {
      const theme = themes[name] as Theme;
      const shots: string[] = [];
      for (const [i, [label, state]] of STATES.entries()) {
        const file = join(outDir, `${name}-${lang}-${i}.html`);
        writeFileSync(file, themedPanel(state, theme, lang));
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 700 });
          await page.goto(`file://${file}`);
          const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
          if (sw > cw) overflow.push(`${name}/${lang}/${label}@${width}: scrollWidth ${sw} > ${cw}`);
          const png = `${name}-${lang}-${i}-${width}.png`;
          await page.screenshot({ path: join(outDir, png), fullPage: true });
          if (width === 320) shots.push(png);
        }
      }
      const sheetFile = join(outDir, `sheet-${name}-${lang}.html`);
      writeFileSync(sheetFile, sheet(name, theme, lang, shots));
      await page.setViewportSize({ width: 5 * 336 + 32, height: 800 });
      await page.goto(`file://${sheetFile}`);
      await page.screenshot({ path: join(outDir, `states-${name}-${lang}.png`), fullPage: true });
    }
  } finally {
    await browser.close();
  }
  console.log(`${STATES.length} states x 4 sheets x ${WIDTHS.length} widths -> ${outDir}`);
  if (overflow.length) {
    console.error(overflow.join('\n'));
    process.exitCode = 1;
  } else console.log('no horizontal overflow');
}

void main();
