import { describe, expect, it } from 'vitest';
import { BUNDLES, normalize, parseQuota, type Language, type QuotaResponse } from '../../src/core';
import type { ErrorResult, MeterState, StateId } from '../../src/extension/state';
import { shortScope, statusView } from '../../src/extension/view';
import { ctx, HOUR, limit, NOW } from './ext-helpers';
import { body } from './fixtures';

const ready = (limits = [limit()], isActive = true): MeterState => ({
  kind: 'ready',
  at: NOW,
  forecasts: {},
  snapshot: { keyName: 'demo', isActive, limits, modelSpend: [] },
});
const error = (result: ErrorResult): MeterState => ({ kind: 'error', result, at: NOW });

/** One state per row of the design brief, plus the settings errors. */
const CASES: [StateId, MeterState, string, string | undefined][] = [
  ['unconfigured', { kind: 'unconfigured' }, 'key', undefined],
  ['loading', { kind: 'loading' }, 'loading~spin', undefined],
  ['ok', ready(), 'dashboard', undefined],
  ['warn', ready([limit({ used: 8.1 })]), 'warning', 'warning'],
  ['critical', ready([limit({ used: 9.4 })]), 'error', 'error'],
  ['exhausted', ready([limit({ used: 10 })]), 'circle-slash', 'error'],
  ['inactive', ready([limit()], false), 'circle-slash', 'warning'],
  ['unauthorized', error({ kind: 'unauthorized', status: 401 }), 'lock', 'error'],
  ['forbidden', error({ kind: 'forbidden', status: 403, expired: false }), 'lock', 'error'],
  ['expired', error({ kind: 'forbidden', status: 403, expired: true }), 'lock', 'error'],
  ['offline', error({ kind: 'offline', reason: 'ECONNREFUSED' }), 'debug-disconnect', undefined],
  ['offline', error({ kind: 'timeout' }), 'debug-disconnect', undefined],
  ['oldGateway', error({ kind: 'notFound', status: 404 }), 'question', 'warning'],
  ['unexpected', error({ kind: 'schema', field: 'budgets' }), 'question', 'warning'],
  ['noLimit', ready([]), 'dashboard', undefined],
  ['insecure', error({ kind: 'insecure', host: 'gw.example.com' }), 'lock', 'warning'],
  ['invalidUrl', error({ kind: 'invalidUrl' }), 'question', 'warning'],
  ['redirect', error({ kind: 'redirect', to: 'https://other.example.com/x' }), 'question', 'warning'],
  ['http', error({ kind: 'http', status: 502 }), 'question', 'warning'],
];

describe('status bar view: every state', () => {
  for (const lang of ['en', 'ms'] as Language[]) {
    it.each(CASES)(`${lang}: %s`, (id, state, icon, background) => {
      const v = statusView(state, ctx(lang));
      expect(v.id).toBe(id);
      expect(v.icon).toBe(icon);
      expect(v.background).toBe(background);
      // No raw bundle key may leak to the screen: every text resolves in both languages.
      for (const text of [v.text, v.accessibility]) {
        expect(text).not.toMatch(/\b(state|status|level|a11y|unit|kind)\.[a-zA-Z.]+/);
        expect(text).not.toMatch(/\{\d\}/);
      }
      expect(v.accessibility.length).toBeGreaterThan(v.text.length);
    });
  }

  it('has a short text and a detail sentence for every state in both bundles', () => {
    for (const [id] of CASES) {
      for (const b of Object.values(BUNDLES)) {
        expect(b[`state.${id}`], id).toBeTruthy();
        expect(b[`state.${id}.detail`], id).toBeTruthy();
      }
    }
  });
});

describe('status bar text', () => {
  it('reads like the brief: percent, remaining, reset', () => {
    expect(statusView(ready(), ctx()).text).toBe('62% · $3.80 left · resets in 4h');
    expect(statusView(ready(), ctx('ms')).text).toMatch(/^62% · baki .*3[.,]80 · set semula dalam 4j$/);
  });
  it('follows statusBar.format', () => {
    expect(statusView(ready(), ctx('en', { format: 'compact' })).text).toBe('62% · $3.80');
    expect(statusView(ready(), ctx('en', { format: 'percent' })).text).toBe('62%');
  });
  it('drops the countdown when the reset time is unknown', () => {
    expect(statusView(ready([limit({ nextReset: null })]), ctx()).text).toBe('62% · $3.80 left');
  });
  it('does not round 99.6% up to 100%', () => {
    expect(statusView(ready([limit({ used: 9.96 })]), ctx()).text).toMatch(/^99\.[5-9]% /);
  });
  it('shows tokens and requests in their own unit', () => {
    const tokens = limit({ id: 'rate:x:tokens', kind: 'tokens', limit: 100_000, used: 90_500 });
    expect(statusView(ready([tokens]), ctx()).text).toBe('90% · 9.5k tokens left · resets in 4h');
  });
  it('shows the strictest limit and respects statusBar.metric', () => {
    const budget = limit({ used: 2 });
    const req = limit({ id: 'rate:x:requests', kind: 'requests', limit: 200, used: 150 });
    expect(statusView(ready([budget, req]), ctx()).text).toBe('75% · 50 requests left · resets in 4h');
    expect(statusView(ready([budget, req]), ctx('en', { metric: 'budget' })).text).toBe('20% · $8.00 left · resets in 4h');
  });
  it('names the used-up limit and when it resets', () => {
    expect(statusView(ready([limit({ used: 10 })]), ctx()).text).toBe('Budget used up · resets in 4h');
  });
  it('spells the state out for screen readers', () => {
    expect(statusView(ready([limit({ used: 8.1 })]), ctx()).accessibility).toBe(
      'Bifrost Meter. Warning. Budget: 81% used, $1.90 left, resets in 4h');
  });
  it('renders the recorded gateway responses', () => {
    for (const name of ['quota-200-after-traffic', 'quota-200-fresh', 'quota-200-no-limits', 'quota-200-inactive']) {
      const parsed = parseQuota(body(name));
      if (!parsed.ok) throw new Error(parsed.field);
      const snapshot = normalize(parsed.value as QuotaResponse, NOW);
      const v = statusView({ kind: 'ready', snapshot, forecasts: {}, at: NOW }, ctx());
      expect(v.text, name).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it('a reset time in the past shows no countdown', () => {
    expect(statusView(ready([limit({ nextReset: NOW - HOUR })]), ctx()).text).toBe('62% · $3.80 left');
  });
});

describe('status bar text for a provider or model limit', () => {
  const provider = limit({ id: 'provider:openai:budget:0', scope: 'provider', scopeLabel: 'openai', used: 6 });
  const model = limit({ id: 'model:gpt-4o-mini:requests', kind: 'requests', scope: 'model', scopeLabel: 'gpt-4o-mini', limit: 200, used: 150 });

  it('names the provider in every format', () => {
    expect(statusView(ready([provider]), ctx()).text).toBe('60% · $4.00 left · resets in 4h · openai');
    expect(statusView(ready([provider]), ctx('en', { format: 'compact' })).text).toBe('60% · $4.00 · openai');
    expect(statusView(ready([provider]), ctx('en', { format: 'percent' })).text).toBe('60% · openai');
    expect(statusView(ready([limit({ ...provider, nextReset: null })]), ctx()).text).toBe('60% · $4.00 left · openai');
  });
  it('names the model in every format', () => {
    expect(statusView(ready([model]), ctx()).text).toBe('75% · 50 requests left · resets in 4h · gpt-4o-mini');
    expect(statusView(ready([model]), ctx('en', { format: 'compact' })).text).toBe('75% · 50 requests · gpt-4o-mini');
    expect(statusView(ready([model]), ctx('en', { format: 'percent' })).text).toBe('75% · gpt-4o-mini');
  });
  it('names the scope of a used-up limit, even when the key budget has room', () => {
    const spent = limit({ ...model, used: 200, remaining: 0, percent: 100 });
    expect(statusView(ready([limit(), spent]), ctx()).text).toBe('Requests used up · resets in 4h · gpt-4o-mini');
    expect(statusView(ready([limit({ ...spent, nextReset: null })]), ctx()).text).toBe('Requests used up · gpt-4o-mini');
  });
  it('names the scope in Malay', () => {
    expect(statusView(ready([provider]), ctx('ms')).text).toMatch(/^60% · baki .*4[.,]00 · set semula dalam 4j · openai$/);
    expect(statusView(ready([limit({ ...provider, used: 10, remaining: 0, percent: 100 })]), ctx('ms')).text).toBe('Bajet habis · set semula dalam 4j · openai');
  });
  it('keeps the scope in the screen reader label, said once', () => {
    expect(statusView(ready([provider]), ctx()).accessibility).toBe(
      'Bifrost Meter. OK. Budget (provider openai): 60% used, $4.00 left, resets in 4h');
  });
  it('leaves a key limit without a name, even when other limits are scoped', () => {
    expect(statusView(ready([limit({ used: 9 }), provider]), ctx()).text).toBe('90% · $1.00 left · resets in 4h');
  });
  it('shortens long model names', () => {
    expect(shortScope('openai')).toBe('openai');
    expect(shortScope('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(shortScope('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-2…');
    expect(shortScope('claude-3-5-sonnet-20241022').length).toBe(20);
    expect(shortScope('trailing/')).toBe('trailing/');
  });
});
