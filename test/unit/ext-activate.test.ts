// Runs activate() against a small stand-in for the VS Code API: checks the wiring (commands, status bar, secrets, settings)
// without an editor. The real editor run is the end-to-end test.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  commands: new Map<string, (...a: unknown[]) => unknown>(),
  item: {} as Record<string, unknown>,
  config: {} as Record<string, unknown>,
  inputs: [] as (string | undefined)[],
  clipboard: '',
  fetched: [] as string[],
}));

vi.mock('vscode', () => {
  class ThemeColor {
    constructor(public id: string) {}
  }
  class MarkdownString {
    isTrusted: unknown;
    constructor(public value: string, public supportThemeIcons: boolean) {}
  }
  const disposable = { dispose: () => undefined };
  return {
    ThemeColor,
    MarkdownString,
    StatusBarAlignment: { Right: 2 },
    ConfigurationTarget: { Global: 1 },
    env: { language: 'en', clipboard: { writeText: async (t: string) => void (h.clipboard = t) } },
    window: {
      createOutputChannel: () => ({ info: () => undefined, show: () => undefined, dispose: () => undefined }),
      createStatusBarItem: () => Object.assign(h.item, { show: () => undefined, dispose: () => undefined }),
      showInputBox: async () => h.inputs.shift(),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showQuickPick: async () => undefined,
      onDidChangeWindowState: () => disposable,
    },
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => (h.commands.set(id, fn), disposable),
      executeCommand: async (id: string) => h.commands.get(id)?.(),
    },
    workspace: {
      getConfiguration: () => ({
        get: (k: string) => h.config[k],
        inspect: (k: string) => ({ globalValue: h.config[k] }),
        update: async (k: string, v: unknown) => void (h.config[k] = v),
      }),
      onDidChangeConfiguration: () => disposable,
    },
  };
});

import { activate } from '../../src/extension/extension';
import { body } from './fixtures';

function context() {
  const secrets = new Map<string, string>();
  const listeners: ((e: { key: string }) => void)[] = [];
  const state = new Map<string, unknown>();
  return {
    subscriptions: [] as { dispose(): void }[],
    globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => void state.set(k, v) },
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => (secrets.set(k, v), listeners.forEach((l) => l({ key: k }))),
      delete: async (k: string) => (secrets.delete(k), listeners.forEach((l) => l({ key: k }))),
      onDidChange: (l: (e: { key: string }) => void) => (listeners.push(l), { dispose: () => undefined }),
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('activate', () => {
  beforeEach(() => {
    h.commands.clear();
    h.config = {};
    h.fetched = [];
    vi.stubGlobal('fetch', async (url: string) => {
      h.fetched.push(String(url));
      return new Response(JSON.stringify(body('quota-200-after-traffic')), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    delete process.env.BIFROST_VIRTUAL_KEY;
  });

  it('registers the commands and asks for a key first', async () => {
    const ctx = context();
    activate(ctx as never);
    await settle();
    expect([...h.commands.keys()]).toHaveLength(7);
    expect(h.item.text).toBe('$(key) Set Bifrost key');
    expect(h.item.command).toBe('bifrostMeter.openDetails');
    expect(h.fetched).toEqual([]);
    ctx.subscriptions.forEach((s) => s.dispose());
  });

  it('after Set Virtual Key, reads the quota and shows the strictest limit', async () => {
    const ctx = context();
    activate(ctx as never);
    await settle();
    h.inputs.push(' sk-bf-test-key-1234 ');
    await h.commands.get('bifrostMeter.setKey')!();
    await settle();
    expect(h.fetched[0]).toBe('http://localhost:8080/api/governance/virtual-keys/quota');
    expect(h.item.text).toMatch(/^\$\(dashboard\) 2% · 195 requests left · /);
    expect(JSON.stringify(h.item)).not.toContain('sk-bf-test-key-1234');
    await h.commands.get('bifrostMeter.copySummary')!();
    expect(h.clipboard).toContain('Requests, 5 of 200, 2%');
    await h.commands.get('bifrostMeter.clearKey')!();
    await settle();
    expect(h.item.text).toBe('$(key) Set Bifrost key');
    ctx.subscriptions.forEach((s) => s.dispose());
  });
});
