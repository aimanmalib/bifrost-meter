import { describe, expect, it } from 'vitest';
import { registerMcpProvider, serverEnv, type McpHost } from '../../src/extension/mcpProvider';

const deps = {
  label: 'Bifrost Meter',
  script: '/ext/dist/mcp.js',
  execPath: '/usr/bin/editor',
  version: '1.2.3',
  baseUrl: () => 'https://gw.example.com',
  key: async () => undefined,
  options: () => ({ allowInsecureHttp: true, language: 'ms', forecastWindowMinutes: 45 }),
};

class EventEmitter {
  event = () => ({ dispose: () => undefined });
  fire() {}
  dispose() {}
}

describe('registerMcpProvider', () => {
  it('does nothing on an editor without the MCP provider API (older than 1.101)', () => {
    expect(registerMcpProvider({ EventEmitter } as unknown as McpHost, deps)).toBeUndefined();
    expect(registerMcpProvider({ EventEmitter, lm: {} } as unknown as McpHost, deps)).toBeUndefined();
    const half = { EventEmitter, lm: { registerMcpServerDefinitionProvider: () => ({ dispose() {} }) } };
    expect(registerMcpProvider(half as unknown as McpHost, deps)).toBeUndefined();
  });

  it('passes the URL and options as environment variables and leaves the key out when none is set', async () => {
    expect(serverEnv(deps)).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      BIFROST_BASE_URL: 'https://gw.example.com',
      BIFROST_ALLOW_INSECURE_HTTP: '1',
      BIFROST_METER_LANGUAGE: 'ms',
      BIFROST_METER_FORECAST_WINDOW_MINUTES: '45',
    });
    let provider: { resolveMcpServerDefinition(s: { env: Record<string, unknown> }): Promise<{ env: Record<string, unknown> }> } | undefined;
    const host = {
      EventEmitter,
      McpStdioServerDefinition: class {
        constructor(public label: string, public command: string, public args: string[], public env: Record<string, unknown>) {}
      },
      lm: { registerMcpServerDefinitionProvider: (_id: string, p: typeof provider) => ((provider = p), { dispose() {} }) },
    };
    expect(registerMcpProvider(host as unknown as McpHost, deps)).toBeDefined();
    const resolved = await provider!.resolveMcpServerDefinition({ env: serverEnv(deps) });
    expect(resolved.env).not.toHaveProperty('BIFROST_VIRTUAL_KEY');
  });
});
