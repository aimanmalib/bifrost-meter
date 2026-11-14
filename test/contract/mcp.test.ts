// Contract: the bundled MCP server, driven by the official SDK client over stdio, against the pinned gateway. The numbers
// it returns must equal what the extension's own client reads from the same key at the same moment.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { fetchQuota, normalize } from '../../src/core';
import { buildServer, connect, textOf, type BuiltServer } from '../unit/mcp-client';

const stack = inject('contract');
let built: BuiltServer | undefined;

describe.skipIf(Boolean(stack.skip))('MCP get_budget_status on the pinned gateway', () => {
  beforeAll(async () => {
    built = await buildServer();
  });
  afterAll(() => built?.cleanup());

  it('lists the tool and returns the same limits as the quota endpoint', async () => {
    const key = stack.keys[0]!;
    const { client, stderr } = await connect(built!.script, {
      BIFROST_BASE_URL: stack.baseUrl,
      BIFROST_VIRTUAL_KEY: key.value,
      BIFROST_ALLOW_INSECURE_HTTP: '1',
    });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['get_budget_status']);
      const res = await client.callTool({ name: 'get_budget_status', arguments: {} });
      expect(res.isError).toBeFalsy();
      const direct = await fetchQuota({ baseUrl: stack.baseUrl, key: key.value, allowInsecureHttp: true });
      if (direct.kind !== 'ok') throw new Error(`quota: ${direct.kind}`);
      const want = normalize(direct.quota, Date.now()).limits.map((l) => ({ kind: l.kind, limit: l.limit, used: l.used }));
      const s = res.structuredContent as { key_name: string; limits: { kind: string; limit: number; used: number }[] };
      expect(s.key_name).toBe(key.name);
      expect(s.limits.map((l) => ({ kind: l.kind, limit: l.limit, used: l.used }))).toEqual(want);
      const out = JSON.stringify(res);
      expect(out).not.toContain(key.value);
      expect(stderr()).not.toContain(key.value);
      // Kept for the docs (docs/MCP.md shows a real call); out/ is ignored by git. The key appears only as its last 4 characters.
      mkdirSync(join(stack.root, 'out'), { recursive: true });
      writeFileSync(join(stack.root, 'out/mcp-call.json'), JSON.stringify({ tools, result: res }, null, 2));
    } finally {
      await client.close();
    }
  });

  it('returns a tool error for a key the gateway does not know', async () => {
    const { client } = await connect(built!.script, {
      BIFROST_BASE_URL: stack.baseUrl,
      BIFROST_VIRTUAL_KEY: ['sk', 'bf', 'contract0unknown0key0000'].join('-'),
      BIFROST_ALLOW_INSECURE_HTTP: '1',
    });
    try {
      const res = await client.callTool({ name: 'get_budget_status', arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/Key rejected/);
    } finally {
      await client.close();
    }
  });
});
