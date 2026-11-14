// DetailsPanel against a small stand-in for the webview API: one tab, options, message routing, no needless re-render.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  created: 0,
  options: undefined as unknown,
  htmlSets: 0,
  html: '',
  executed: [] as string[],
  onMessage: undefined as undefined | ((m: unknown) => void),
  onDispose: undefined as undefined | (() => void),
  revealed: 0,
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  commands: { executeCommand: async (id: string) => void h.executed.push(id) },
  window: {
    createWebviewPanel: (_type: string, _title: string, _col: number, options: unknown) => {
      h.created++;
      h.options = options;
      const webview = {
        set html(v: string) {
          h.htmlSets++;
          h.html = v;
        },
        get html() {
          return h.html;
        },
        onDidReceiveMessage: (fn: (m: unknown) => void) => void (h.onMessage = fn),
      };
      return {
        webview,
        title: '',
        reveal: () => void h.revealed++,
        onDidDispose: (fn: () => void) => void (h.onDispose = fn),
        dispose: () => h.onDispose?.(),
      };
    },
  },
}));

import type { MeterState } from '../../src/extension/state';
import { DetailsPanel } from '../../src/extension/panel';
import { ctx, limit, NOW } from './ext-helpers';

const KEY = ['sk', 'bf', 'x'.repeat(16) + 'WXYZ'].join('-');
let state: MeterState;
const make = () =>
  new DetailsPanel({
    state: () => state,
    key: () => KEY,
    store: { get: () => undefined, update: async () => undefined, keys: () => [] } as never,
    ctx: () => ctx('en', {}, NOW),
    // A refused URL: no network call is made for the version.
    baseUrl: () => 'http://gw.example.com',
  });

beforeEach(() => {
  Object.assign(h, { created: 0, htmlSets: 0, html: '', executed: [], revealed: 0 });
  state = { kind: 'ready', at: NOW, forecasts: {}, snapshot: { keyName: 'demo', isActive: true, limits: [limit()], modelSpend: [] } };
});

describe('DetailsPanel', () => {
  it('opens one tab with scripts on, command links off and no local resources', () => {
    const p = make();
    p.update(); // closed: nothing happens
    expect(h.created).toBe(0);
    p.show();
    p.show();
    expect(h.created).toBe(1);
    expect(h.revealed).toBe(1);
    expect(h.options).toEqual({ enableScripts: true, enableCommandUris: false, localResourceRoots: [] });
    expect(h.html).toContain('$6.20 of $10.00');
  });
  it('replaces the page only when the content changes (keeps scroll and focus)', () => {
    const p = make();
    p.show();
    p.update();
    p.update();
    expect(h.htmlSets).toBe(1);
    state = { kind: 'ready', at: NOW, forecasts: {}, snapshot: { keyName: 'demo', isActive: true, limits: [limit({ used: 7 })], modelSpend: [] } };
    p.update();
    expect(h.htmlSets).toBe(2);
    expect(h.html).toContain('$7.00 of $10.00');
  });
  it('runs only the commands the panel offers', () => {
    make().show();
    h.onMessage?.({ action: 'refresh' });
    h.onMessage?.({ action: 'clearKey' });
    h.onMessage?.({ action: 'workbench.action.terminal.new' });
    expect(h.executed).toEqual(['bifrostMeter.refresh']);
  });
  it('opens a new tab after the old one is closed', () => {
    const p = make();
    p.show();
    p.dispose();
    p.show();
    expect(h.created).toBe(2);
    expect(h.htmlSets).toBe(2);
  });
});
