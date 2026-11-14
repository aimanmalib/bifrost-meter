// Registers the bundled MCP server (dist/mcp.js) with the editor, so chat agents can call get_budget_status without manual
// setup. The registration API exists from VS Code 1.101; it is detected at run time and older editors simply skip it
// (docs/MCP.md shows the manual configuration). See ADR 0010.

import type { Disposable, Event } from 'vscode';
import { ENV_ALLOW_INSECURE, ENV_FORECAST_WINDOW, ENV_LANGUAGE } from '../mcp/config';
import { ENV_BASE_URL, ENV_KEY } from './secrets';

export const MCP_PROVIDER_ID = 'bifrostMeter.mcp';

type Env = Record<string, string | number | null>;

interface StdioDefinition {
  env: Env;
}

type StdioCtor = new (label: string, command: string, args: string[], env: Env, version?: string) => StdioDefinition;

interface Provider {
  onDidChangeMcpServerDefinitions: Event<void>;
  provideMcpServerDefinitions(): StdioDefinition[];
  resolveMcpServerDefinition(server: StdioDefinition): Promise<StdioDefinition>;
}

/** The parts of the `vscode` module this file uses; all optional so an older editor's module fits too. */
export interface McpHost {
  lm?: { registerMcpServerDefinitionProvider?: (id: string, provider: Provider) => Disposable };
  McpStdioServerDefinition?: StdioCtor;
  EventEmitter: new () => { event: Event<void>; fire(): void; dispose(): void };
}

export interface McpDeps {
  label: string;
  /** Absolute path of dist/mcp.js inside the installed extension. */
  script: string;
  /** The editor's own runtime, so no separate Node.js install is needed. */
  execPath: string;
  version: string;
  baseUrl(): string;
  key(): Promise<string | undefined>;
  options(): { allowInsecureHttp: boolean; language: string; forecastWindowMinutes: number };
}

/** Environment for the server process, without the key (added only when the editor starts the server). */
export function serverEnv(deps: Pick<McpDeps, 'baseUrl' | 'options'>): Env {
  const o = deps.options();
  return {
    // The editor binary runs plain Node.js scripts with this flag; a Node.js execPath (code-server) ignores it.
    ELECTRON_RUN_AS_NODE: '1',
    [ENV_BASE_URL]: deps.baseUrl(),
    [ENV_ALLOW_INSECURE]: o.allowInsecureHttp ? '1' : '0',
    [ENV_LANGUAGE]: o.language,
    [ENV_FORECAST_WINDOW]: String(o.forecastWindowMinutes),
  };
}

/**
 * Returns the registration and a `changed` callback (call it when the key, URL or options change), or undefined when the
 * editor has no MCP provider API.
 */
export function registerMcpProvider(host: McpHost, deps: McpDeps): { disposables: Disposable[]; changed(): void } | undefined {
  const register = host.lm?.registerMcpServerDefinitionProvider;
  const Ctor = host.McpStdioServerDefinition;
  if (typeof register !== 'function' || typeof Ctor !== 'function') return undefined;
  const emitter = new host.EventEmitter();
  const provider: Provider = {
    onDidChangeMcpServerDefinitions: emitter.event,
    provideMcpServerDefinitions: () => [new Ctor(deps.label, deps.execPath, [deps.script], serverEnv(deps), deps.version)],
    // The key is read from SecretStorage at start, so it never sits in the listed definition.
    resolveMcpServerDefinition: async (server) => {
      const key = await deps.key();
      if (key) server.env = { ...server.env, [ENV_KEY]: key };
      return server;
    },
  };
  const registration = register.call(host.lm, MCP_PROVIDER_ID, provider);
  return { disposables: [registration, emitter], changed: () => emitter.fire() };
}
