import { describe, expect, it } from 'vitest';
import { formatClock, type Forecast, type Series } from '../../src/core';
import { barSvg, chartPoints, chartSvg } from '../../src/extension/chart';
import { esc, PANEL_ACTIONS, panelCommand, panelHtml, type PanelInput } from '../../src/extension/panelHtml';
import type { ErrorResult, MeterState, Reading } from '../../src/extension/state';
import { ctx, HOUR, limit, NOW } from './ext-helpers';

// Built at runtime so the test file holds nothing shaped like a real key.
const KEY = ['sk', 'bf', 'x'.repeat(16) + 'WXYZ'].join('-');
const NONCE = 'bm9uY2UtZm9yLXRlc3Q=';
const rising: Forecast = { status: 'rising', ratePerHour: 1, exhaustAt: NOW + 2 * HOUR, beforeReset: true, leadMs: 2 * HOUR };

const reading = (over: Partial<Reading['snapshot']> = {}): Reading => ({
  at: NOW,
  forecasts: { 'budget:a': rising },
  snapshot: {
    keyName: 'demo',
    isActive: true,
    limits: [limit({ used: 8.1 }), limit({ id: 'rate:r:requests', kind: 'requests', limit: 200, used: 5 })],
    modelSpend: [
      { model: 'mock-large', usd: 0.2 },
      { model: 'mock-small', usd: 0.05 },
    ],
    ...over,
  },
});
const ready = (over: Partial<Reading['snapshot']> = {}): MeterState => ({ kind: 'ready', ...reading(over) });
const error = (result: ErrorResult, last?: Reading): MeterState => ({ kind: 'error', result, at: NOW, ...(last ? { last } : {}) });

const series: Record<string, Series> = {
  'budget:a': { cycle: 'c', samples: [{ t: NOW - 20 * 60_000, used: 6 }, { t: NOW - 10 * 60_000, used: 7 }, { t: NOW, used: 8.1 }] },
};

const html = (state: MeterState, lang: 'en' | 'ms' = 'en', over: Partial<PanelInput> = {}) =>
  panelHtml({ state, key: KEY, baseUrl: 'http://localhost:8080', version: 'v2.5.1', series, ...over }, ctx(lang, {}, NOW), { nonce: NONCE });

const ALL_STATES: MeterState[] = [
  { kind: 'unconfigured' },
  { kind: 'loading' },
  ready(),
  ready({ limits: [limit({ used: 9.5 })] }),
  ready({ limits: [limit({ used: 10 })] }),
  ready({ isActive: false }),
  ready({ limits: [], modelSpend: [] }),
  error({ kind: 'unauthorized', status: 401 }),
  error({ kind: 'forbidden', status: 403, expired: true }),
  error({ kind: 'forbidden', status: 403, expired: false }),
  error({ kind: 'offline', reason: 'ECONNREFUSED' }, reading()),
  error({ kind: 'timeout' }),
  error({ kind: 'notFound', status: 404 }),
  error({ kind: 'schema', field: 'budgets' }),
  error({ kind: 'http', status: 500 }),
  error({ kind: 'insecure', host: 'gw.example.com' }),
  error({ kind: 'invalidUrl' }),
  error({ kind: 'redirect', to: 'https://elsewhere.example' }),
];

describe('panel html: security', () => {
  it('has a strict policy and puts the nonce on its only style and script', () => {
    const h = html(ready());
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(h)?.[1] ?? '';
    expect(csp).toMatch(/^default-src 'none';/);
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`);
    expect(csp).toContain(`style-src 'nonce-${NONCE}'`);
    expect(csp).not.toContain('unsafe');
    expect(h.match(/<script/g)).toHaveLength(1);
    expect(h.match(/<style/g)).toHaveLength(1);
    expect(h).toContain(`<script nonce="${NONCE}">`);
    expect(h).toContain(`<style nonce="${NONCE}">`);
  });
  it('loads nothing: no src, href, url() or @import, and no inline handlers or style attributes', () => {
    for (const state of ALL_STATES) {
      const h = html(state);
      expect(h).not.toMatch(/\s(src|href|style|on[a-z]+)=/i);
      expect(h).not.toMatch(/url\(|@import/);
    }
  });
  it('never shows the key beyond its last four characters', () => {
    for (const state of ALL_STATES) {
      const h = html(state);
      expect(h).not.toContain(KEY);
      expect(h).not.toContain('xxxxxxxx');
      expect(h).toContain('WXYZ');
    }
  });
  it('escapes names from the gateway', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const h = html(ready({ keyName: evil, modelSpend: [{ model: `"><script>alert(2)</script>`, usd: 1 }] }));
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<script>alert');
    expect(h).toContain(esc(evil));
    expect(esc(`<a href="x">'&`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  });
  it('runs only the panel actions it offers', () => {
    for (const a of PANEL_ACTIONS) expect(panelCommand({ action: a })).toBe(`bifrostMeter.${a}`);
    for (const bad of [{ action: 'clearKey' }, { action: 'workbench.action.terminal.new' }, { action: 1 }, null, 'refresh', {}]) {
      expect(panelCommand(bad)).toBeUndefined();
    }
    const offered = [...html(ready()).matchAll(/<button type="button" data-action="([^"]+)"/g)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThan(0);
    for (const a of offered) expect(PANEL_ACTIONS).toContain(a);
  });
});

describe('panel html: content', () => {
  it('renders every state in both languages with no missing text', () => {
    for (const lang of ['en', 'ms'] as const) {
      for (const state of ALL_STATES) {
        const h = html(state, lang);
        expect(h).toContain(`<html lang="${lang}">`);
        expect(h).not.toMatch(/>[^<]*\b(panel|action|state|level|tooltip|summary|kind)\.[a-zA-Z]+/);
        expect(h).not.toMatch(/\{\d\}/);
      }
    }
  });
  it('shows each limit with its numbers, level word and threshold bar', () => {
    const h = html(ready());
    expect(h).toContain('$8.10 of $10.00');
    expect(h).toContain('81%');
    expect(h).toContain('Warning');
    expect(h).toContain('$1.90 left');
    expect(h).toContain('resets in 4h');
    expect(h).toMatch(/Runs out around \d\d:\d\d, 2h before the reset/);
    expect(h).toContain('aria-valuenow="81"');
    expect(h).toContain('5 of 200');
    expect(h).toContain('version v2.5.1');
    expect(h).toContain('http://localhost:8080');
  });
  it('lists spend per model in the order given (highest cost first) or says there is none', () => {
    const h = html(ready());
    expect(h.indexOf('mock-large')).toBeLessThan(h.indexOf('mock-small'));
    expect(html(ready({ modelSpend: [] }))).toContain('no spend per model');
  });
  it('draws the usage chart only with two samples or more', () => {
    expect(html(ready())).toContain('<svg class="chart"');
    const one = { 'budget:a': { cycle: 'c', samples: [{ t: NOW, used: 8.1 }] } };
    expect(html(ready(), 'en', { series: one })).not.toContain('<svg class="chart"');
  });
  it('says in words that usage has not moved instead of drawing a flat line', () => {
    const flat = { 'budget:a': { cycle: 'c', samples: [{ t: NOW - 10 * 60_000, used: 0 }, { t: NOW, used: 0 }] } };
    for (const lang of ['en', 'ms'] as const) {
      const h = html(ready(), lang, { series: flat });
      expect(h).not.toContain('<svg class="chart"');
      expect(h).toContain(ctx(lang, {}, NOW).t('panel.chart.flat', formatClock(NOW - 10 * 60_000, lang)));
    }
  });
  it('drops the track fill in high contrast themes so the fill stands out', () => {
    expect(html(ready())).toMatch(/body\.vscode-high-contrast \.bar \.track[^{]*\{ fill: transparent; \}/);
  });
  it('leads a problem state with what happened and the button that fixes it', () => {
    const h = html(error({ kind: 'unauthorized', status: 401 }));
    expect(h).toContain('role="alert"');
    expect(h).toMatch(/<button type="button" data-action="setKey" class="primary">/);
    expect(h.match(/data-action="setKey"/g)).toHaveLength(1);
    expect(html(ready()).match(/data-action="setKey"/g)).toHaveLength(1);
    expect(html({ kind: 'unconfigured' })).toMatch(/data-action="setKey" class="primary"/);
    expect(html(error({ kind: 'insecure', host: 'gw.example.com' }))).toMatch(/data-action="setBaseUrl" class="primary"/);
  });
  it('keeps the last known numbers when the gateway goes offline', () => {
    const h = html(error({ kind: 'offline', reason: 'x' }, reading()));
    expect(h).toMatch(/Last known numbers from \d\d:\d\d/);
    expect(h).toContain('$8.10 of $10.00');
  });
  it('says when the version is unknown', () => {
    expect(html(ready(), 'en', { version: undefined })).toContain('version unknown');
    expect(html(ready(), 'ms', { version: undefined })).toContain('versi tidak diketahui');
  });
});

describe('chart svg', () => {
  it('clamps the bar to 0–100 and marks both thresholds', () => {
    expect(barSvg(250, 'exhausted', 75, 90, 'x')).toContain('aria-valuenow="100"');
    expect(barSvg(Infinity, 'exhausted', 75, 90, 'x')).toContain('width="100"');
    expect(barSvg(-5, 'ok', 75, 90, 'x')).toContain('aria-valuenow="0"');
    const b = barSvg(40, 'ok', 60, 85, 'x');
    expect(b).toContain('x1="60"');
    expect(b).toContain('x1="85"');
  });
  it('scales samples to the box with the limit or the peak on top', () => {
    const { points, limitY } = chartPoints([{ t: 0, used: 0 }, { t: 10, used: 5 }], 10);
    expect(points).toEqual([{ x: 0, y: 80 }, { x: 300, y: 40 }]);
    expect(limitY).toBe(0);
    const over = chartPoints([{ t: 0, used: 0 }, { t: 10, used: 20 }], 10);
    expect(over.limitY).toBe(40);
    expect(over.points[1]).toEqual({ x: 300, y: 0 });
    expect(chartSvg([{ t: 0, used: 1 }], { limit: 10 }, 'x')).toBe('');
  });
});
