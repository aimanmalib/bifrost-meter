// Starts the bundled server as a child process and talks to it with the official SDK client over stdio, against a local
// HTTP stand-in that answers with recorded gateway responses. The contract suite repeats this against the real gateway.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixture } from './fixtures';
import { buildServer, connect as connectTo, textOf, type BuiltServer } from './mcp-client';

const KEY = ['sk', 'bf', 'mcp0stdio0value0qrst5432'].join('-');
let built: BuiltServer;
let http: Server;
let baseUrl: string;
const seen: (string | undefined)[] = [];

beforeAll(async () => {
  built = await buildServer();
  http = createServer((req, res) => {
    const key = req.headers['x-bf-vk'];
    seen.push(typeof key === 'string' ? key : undefined);
    const f = req.url === '/api/governance/virtual-keys/quota' && key === KEY ? fixture('quota-200-after-traffic') : fixture('quota-401-unknown-key');
    res.writeHead(f.status, { 'content-type': 'application/json' }).end(JSON.stringify(f.body));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => http?.close(r));
  built?.cleanup();
});

const connect = (env: Record<string, string>) => connectTo(built.script, env);

describe('MCP server over stdio', () => {
  it('lists one read-only tool with an output schema and returns the quota as structured data', async () => {
    const { client, stderr } = await connect({ BIFROST_BASE_URL: baseUrl, BIFROST_VIRTUAL_KEY: KEY });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['get_budget_status']);
      const tool = tools[0];
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([]);
      expect(tool?.outputSchema?.required).toEqual(expect.arrayContaining(['limits', 'is_exhausted', 'will_exhaust_before_reset', 'read_at']));

      const res = await client.callTool({ name: 'get_budget_status', arguments: {} });
      expect(res.isError).toBeFalsy();
      const s = res.structuredContent as { key_name: string; key_hint: string; limits: { kind: string; remaining: number }[] };
      expect(s.key_name).toBe('demo-team-a');
      expect(s.key_hint).toBe('…5432');
      expect(s.limits.find((l) => l.kind === 'requests')?.remaining).toBe(194);
      const text = textOf(res);
      expect(text).toContain('Requests: 6 of 200 used');
      expect(JSON.stringify(res)).not.toContain(KEY);
      expect(stderr()).not.toContain(KEY);
      expect(seen.at(-1)).toBe(KEY);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('returns a tool error, not a crash, when the gateway rejects the key or no key is set', async () => {
    const wrong = await connect({ BIFROST_BASE_URL: baseUrl, BIFROST_VIRTUAL_KEY: ['sk', 'bf', 'wrong0value0000'].join('-') });
    try {
      const res = await wrong.client.callTool({ name: 'get_budget_status', arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/^Could not read the quota\. Key rejected/);
    } finally {
      await wrong.client.close();
    }
    const none = await connect({ BIFROST_BASE_URL: baseUrl });
    try {
      const res = await none.client.callTool({ name: 'get_budget_status', arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain('BIFROST_VIRTUAL_KEY is not set');
    } finally {
      await none.client.close();
    }
  }, 30_000);
});
