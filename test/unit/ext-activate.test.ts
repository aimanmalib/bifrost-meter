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
  mcp: [] as { id: string; provider: Record<string, (...a: unknown[]) => unknown> }[],
  fired: 0,
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
  class EventEmitter {
    event = () => disposable;
    fire() {
      h.fired++;
    }
    dispose() {}
  }
  class McpStdioServerDefinition {
    constructor(public label: string, public command: string, public args: string[], public env: Record<string, unknown>, public version?: string) {}
  }
  return {
    EventEmitter,
    McpStdioServerDefinition,
    lm: {
      registerMcpServerDefinitionProvider: (id: string, provider: Record<string, (...a: unknown[]) => unknown>) => (h.mcp.push({ id, provider }), disposable),
    },
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
    asAbsolutePath: (p: string) => `/ext/${p}`,
    extension: { packageJSON: { version: '9.8.7' } },
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
    h.mcp = [];
    h.fired = 0;
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
    // Expected text derived from the fixture (the strictest limit is the request rate limit), not copied from it.
    const rl = (body('quota-200-after-traffic') as { rate_limit: { request_max_limit: number; request_current_usage: number } }).rate_limit;
    const left = rl.request_max_limit - rl.request_current_usage;
    const pct = Math.floor((rl.request_current_usage / rl.request_max_limit) * 100);
    expect(h.item.text).toMatch(new RegExp(`^\\$\\(dashboard\\) ${pct}% · ${left} requests left · `));
    expect(JSON.stringify(h.item)).not.toContain('sk-bf-test-key-1234');
    await h.commands.get('bifrostMeter.copySummary')!();
    expect(h.clipboard).toContain(`Requests, ${rl.request_current_usage} of ${rl.request_max_limit}, ${pct}%`);
    await h.commands.get('bifrostMeter.clearKey')!();
    await settle();
    expect(h.item.text).toBe('$(key) Set Bifrost key');
    ctx.subscriptions.forEach((s) => s.dispose());
  });

  it('registers the MCP server with the editor and hands it the key only at start', async () => {
    const ctx = context();
    activate(ctx as never);
    await settle();
    expect(h.mcp.map((m) => m.id)).toEqual(['bifrostMeter.mcp']);
    const provider = h.mcp[0]!.provider;
    const [def] = provider.provideMcpServerDefinitions!() as { label: string; command: string; args: string[]; env: Record<string, unknown>; version: string }[];
    expect(def).toMatchObject({ label: 'Bifrost Meter', command: process.execPath, args: ['/ext/dist/mcp.js'], version: '9.8.7' });
    expect(def!.env).toMatchObject({ BIFROST_BASE_URL: 'http://localhost:8080', BIFROST_ALLOW_INSECURE_HTTP: '0', ELECTRON_RUN_AS_NODE: '1' });
    expect(def!.env).not.toHaveProperty('BIFROST_VIRTUAL_KEY');
    const key = ['sk', 'bf', 'mcp0activate0value0lmno'].join('-');
    h.inputs.push(key);
    await h.commands.get('bifrostMeter.setKey')!();
    await settle();
    expect(h.fired).toBe(1);
    const resolved = (await provider.resolveMcpServerDefinition!(def)) as { env: Record<string, unknown> };
    expect(resolved.env.BIFROST_VIRTUAL_KEY).toBe(key);
    expect(JSON.stringify(provider.provideMcpServerDefinitions!())).not.toContain(key);
    ctx.subscriptions.forEach((s) => s.dispose());
  });
});
