// Contract: the real quota endpoint on the pinned gateway, read through the extension's own client.
// Expected limits come from demo/demo.config.json, so changing the demo config does not break these tests.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, inject, it } from 'vitest';
import { fetchQuota, fetchVersion, normalize, QUOTA_PATH, type QuotaResponse } from '../../src/core';

const run = promisify(execFile);
const stack = inject('contract');
const config = stack.root ? JSON.parse(readFileSync(join(stack.root, 'demo/demo.config.json'), 'utf8')) : { virtualKeys: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function quotaOk(key: string): Promise<QuotaResponse> {
  const r = await fetchQuota({ baseUrl: stack.baseUrl, key, allowInsecureHttp: true });
  if (r.kind !== 'ok') throw new Error(`expected 200 quota, got ${r.kind}`);
  return r.quota;
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${stack.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bifrost-setup-token': stack.setupToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe.skipIf(Boolean(stack.skip))('quota API contract on the pinned gateway', () => {
  it('reports a version from /api/version without a key', async () => {
    expect(await fetchVersion(stack.baseUrl, true)).toMatch(/^v?\d+\.\d+/);
  });

  it('returns 200 with the seeded budgets and rate limits for every demo key', async () => {
    expect(stack.keys.map((k) => k.name)).toEqual(config.virtualKeys.map((v: { name: string }) => v.name));
    for (const [i, vk] of config.virtualKeys.entries()) {
      const q = await quotaOk(stack.keys[i]?.value ?? '');
      expect(q.virtual_key_name).toBe(vk.name);
      expect(q.is_active).toBe(true);
      expect(q.budgets.map((b) => [b.max_limit, b.reset_duration])).toEqual(
        vk.budgets.map((b: { max_limit: number; reset_duration: string }) => [b.max_limit, b.reset_duration]),
      );
      for (const [field, value] of Object.entries(vk.rate_limit ?? {})) {
        expect(q.rate_limit?.[field as keyof NonNullable<QuotaResponse['rate_limit']>]).toBe(value);
      }
    }
  });

  it('returns 401 without a key header', async () => {
    const res = await fetch(`${stack.baseUrl}${QUOTA_PATH}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unknown key', async () => {
    const unknown = ['sk', 'bf', 'contract', 'unknown', '0000'].join('-');
    const r = await fetchQuota({ baseUrl: stack.baseUrl, key: unknown, allowInsecureHttp: true });
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 403 "expired" for a key past its expiry', async () => {
    const created = await admin('POST', '/api/governance/virtual-keys', {
      name: `contract-expiring-${Date.now()}`,
      expires_at: new Date(Date.now() + 2000).toISOString(),
      budgets: [{ max_limit: 1, reset_duration: '1d' }],
    });
    const value = (created.json.virtual_key as { value?: string } | undefined)?.value;
    expect(created.status).toBe(200);
    await sleep(3500);
    const r = await fetchQuota({ baseUrl: stack.baseUrl, key: value, allowInsecureHttp: true });
    expect(r).toMatchObject({ kind: 'forbidden', status: 403, expired: true });
  });

  it('moves the budget, token and request counters after mock traffic', async () => {
    const key = stack.keys[0];
    if (!key) throw new Error('seed returned no keys');
    const before = await quotaOk(key.value);
    const requests = 3;
    const { stdout } = await run(
      process.execPath,
      [join(stack.root, 'demo/traffic/traffic.mjs'), '--key', key.name, '--requests', String(requests), '--interval', '0.2'],
      { env: { ...process.env, BIFROST_URL: stack.baseUrl, BIFROST_SETUP_TOKEN: stack.setupToken }, timeout: 60_000 },
    );
    expect(JSON.parse(stdout.trim().split('\n').pop() ?? '{}')).toEqual({ sent: requests, failed: 0 });
    // Usage is written asynchronously after each request (measured lag: 2 to 6 s); poll for up to 30 s.
    const want = (before.rate_limit?.request_current_usage ?? 0) + requests;
    const sentAt = Date.now();
    let after = before;
    while (Date.now() - sentAt < 30_000) {
      after = await quotaOk(key.value);
      const models = after.budgets[0]?.per_model_usage?.length ?? 0;
      if ((after.rate_limit?.request_current_usage ?? 0) >= want && models >= Math.min(requests, config.provider.models.length)) break;
      await sleep(500);
    }
    console.warn(`[contract] counters visible ${((Date.now() - sentAt) / 1000).toFixed(1)} s after the last request`);
    expect(after.rate_limit?.request_current_usage).toBe((before.rate_limit?.request_current_usage ?? 0) + requests);
    expect(after.rate_limit?.token_current_usage ?? 0).toBeGreaterThan(before.rate_limit?.token_current_usage ?? 0);
    expect(after.budgets[0]?.current_usage ?? 0).toBeGreaterThan(before.budgets[0]?.current_usage ?? 0);
    // Spend per model: traffic rotates over the configured models, and the meter reads a positive USD amount for each.
    const spend = normalize(after, Date.now()).modelSpend;
    expect(spend.map((m) => m.model).sort()).toEqual([...config.provider.models].slice(0, requests).sort());
    for (const m of spend) expect(m.usd).toBeGreaterThan(0);
  });

  it('shows the enforced limit after an admin override on a budget', async () => {
    const name = `contract-override-${Date.now()}`;
    const created = await admin('POST', '/api/governance/virtual-keys', { name, budgets: [{ max_limit: 2, reset_duration: '1d' }] });
    const vk = created.json.virtual_key as { id: string; value: string; budgets?: { id: string }[] };
    expect(created.status).toBe(200);
    const listed = await admin('GET', '/api/governance/virtual-keys');
    const budgetId = (listed.json.virtual_keys as typeof vk[]).find((k) => k.id === vk.id)?.budgets?.[0]?.id ?? '';
    const put = await admin('PUT', `/api/governance/virtual-keys/${vk.id}/budgets/${budgetId}/override`, { amount: 3, mode: 'forever' });
    expect(put.status).toBe(200);
    const q = await quotaOk(vk.value);
    expect(q.budgets[0]?.max_limit).toBe(2);
    expect(normalize(q, Date.now()).limits.find((l) => l.kind === 'budget')?.limit).toBe(5);
  });
});

if (stack.skip) {
  describe('quota API contract (skipped)', () => {
    it.skip(`${stack.skip}`, () => {});
  });
}
