import { describe, expect, it } from 'vitest';
import type { Forecast } from '../../src/core';
import type { MeterState } from '../../src/extension/state';
import { md, summaryText, tooltipMarkdown } from '../../src/extension/tooltip';
import { noteText } from '../../src/extension/noteText';
import { ctx, HOUR, limit, NOW } from './ext-helpers';

// Built at runtime so the test file holds nothing shaped like a real key.
const KEY = ['sk', 'bf', 'x'.repeat(16) + 'WXYZ'].join('-');
const rising: Forecast = { status: 'rising', ratePerHour: 1, exhaustAt: NOW + 2 * HOUR, beforeReset: true, leadMs: 2 * HOUR };
const ready = (keyName = 'demo'): MeterState => ({
  kind: 'ready',
  at: NOW,
  forecasts: { 'budget:a': rising },
  snapshot: { keyName, isActive: true, limits: [limit(), limit({ id: 'rate:r:requests', kind: 'requests', limit: 200, used: 5 })], modelSpend: [] },
});
const tip = (state: MeterState, lang: 'en' | 'ms' = 'en') =>
  tooltipMarkdown({ state, key: KEY, baseUrl: 'http://localhost:8080' }, ctx(lang, {}, NOW));

describe('tooltip', () => {
  it('lists every limit, the forecast and the command links', () => {
    const t = tip(ready());
    expect(t).toContain('| Budget | $6\\.20 of $10\\.00 | 62% | $3\\.80 | 4h |');
    expect(t).toContain('| Requests | 5 of 200 |');
    expect(t).toMatch(/Runs out around \d\d:\d\d, 2h before the reset/);
    expect(t).toContain('](command:bifrostMeter.refresh)');
    expect(t).toContain('](command:bifrostMeter.openDetails)');
  });
  it('never shows the key beyond its last four characters', () => {
    for (const state of [ready(), { kind: 'error', result: { kind: 'unauthorized', status: 401 }, at: NOW } as MeterState]) {
      const t = tip(state);
      expect(t).not.toContain(KEY);
      expect(t).not.toContain('xxxxxxxx');
      expect(t).toContain('WXYZ');
    }
  });
  it('escapes names from the gateway so they cannot add links or formatting', () => {
    const t = tip(ready('[click](command:workbench.action.terminal.new) **x**'));
    expect(t).not.toContain('[click](command:workbench');
    expect(t).toContain('\\[click\\]');
    expect(md('a|b')).toBe('a\\|b');
  });
  it('offers the fix for problem states', () => {
    expect(tip({ kind: 'unconfigured' })).toContain('](command:bifrostMeter.setKey)');
    expect(tip({ kind: 'error', result: { kind: 'invalidUrl' }, at: NOW })).toContain('](command:bifrostMeter.setBaseUrl)');
  });
  it('keeps the last known numbers when the gateway goes offline', () => {
    const last = ready() as Extract<MeterState, { kind: 'ready' }>;
    const t = tip({ kind: 'error', result: { kind: 'offline', reason: 'x' }, at: NOW, last });
    expect(t).toContain('The gateway did not answer');
    expect(t).toContain('| Budget |');
    expect(t).toMatch(/Last known numbers from \d\d:\d\d/);
  });
  it('is fully translated in Malay', () => {
    const t = tip(ready(), 'ms');
    expect(t).toContain('Bajet');
    expect(t).toContain('Muat semula');
    expect(t).not.toMatch(/\b(col|tooltip|action|forecast)\.[a-z]/);
  });
});

describe('summary and notifications', () => {
  it('copies one line per limit without the key', () => {
    const s = summaryText({ state: ready(), key: KEY, baseUrl: 'x' }, ctx());
    expect(s.split('\n')[0]).toBe('Bifrost Meter: demo');
    expect(s).toContain('- Budget, $6.20 of $10.00, 62%, $3.80 left, resets in 4h');
    expect(s).not.toContain('WXYZ');
  });
  it('words each notification', () => {
    const c = ctx();
    expect(noteText({ kind: 'threshold', level: 'warn', limit: limit({ used: 8 }) }, c)).toBe('Budget: 80% used, $2.00 left.');
    expect(noteText({ kind: 'threshold', level: 'exhausted', limit: limit({ used: 10 }) }, c)).toMatch(/^Budget: used up\./);
    expect(noteText({ kind: 'threshold', level: 'warn', limit: limit({ kind: 'requests', used: 8 }) }, c)).not.toMatch(/ is at /);
    expect(noteText({ kind: 'forecast', limit: limit(), forecast: rising as Extract<Forecast, { status: 'rising' }> }, c)).toMatch(
      /^Budget: at the current pace it runs out around \d\d:\d\d, 2h before the limit resets\.$/);
  });
});
