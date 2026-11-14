// One-shot seed for the Bifrost Meter demo.
// Waits for Bifrost, points the provider from demo.config.json at the mock
// upstream, and creates the demo virtual keys (budgets + rate limits).
// Usage: node demo/seed/seed.mjs [--config demo/demo.config.json] [--out keys.json] [--quiet]
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: new URL('../demo.config.json', import.meta.url).pathname },
    out: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const baseUrl = (process.env.BIFROST_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const setupToken = process.env.BIFROST_SETUP_TOKEN;
const healthTimeoutMs = Number(process.env.SEED_HEALTH_TIMEOUT_MS ?? 180_000);
if (!setupToken) {
  console.error('seed: BIFROST_SETUP_TOKEN is not set (the same value the gateway container uses).');
  process.exit(2);
}

const config = JSON.parse(await readFile(args.config, 'utf8'));
const log = (msg) => console.error(`seed: ${msg}`);

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bifrost-setup-token': setupToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < healthTimeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return Date.now() - started;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`gateway at ${baseUrl} did not answer /health within ${healthTimeoutMs} ms`);
}

async function ensureProvider() {
  const p = config.provider;
  const existing = await api('GET', `/api/providers/${encodeURIComponent(p.name)}`);
  if (existing.status === 200) return 'present';
  const res = await api('POST', '/api/providers', {
    provider: p.name,
    network_config: { base_url: p.mockBaseUrl, allow_private_network: true },
  });
  if (res.status !== 200) throw new Error(`provider create failed: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  // v2.5.1 ignores `keys` on provider create; keys have their own endpoint.
  // The mock upstream accepts any key, so this placeholder is not a secret.
  const key = await api('POST', `/api/providers/${encodeURIComponent(p.name)}/keys`, {
    name: 'mock-upstream', value: 'mock-key-not-a-secret', models: p.models, weight: 1,
  });
  if (key.status !== 200) throw new Error(`provider key create failed: HTTP ${key.status}`);
  return 'created';
}

async function createVirtualKey(vk) {
  const res = await api('POST', '/api/governance/virtual-keys', {
    name: vk.name,
    budgets: vk.budgets,
    rate_limit: vk.rate_limit,
    // v2.5.1 blocks every model when allowed_models is ['*']; list them explicitly.
    provider_configs: [{ provider: config.provider.name, allowed_models: config.provider.models, key_ids: ['*'], weight: 1 }],
    ...(vk.expires_at ? { expires_at: vk.expires_at } : {}),
  });
  const value = res.json?.virtual_key?.value;
  if (res.status !== 200 || !value) throw new Error(`virtual key "${vk.name}" failed: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  return { name: vk.name, value };
}

const waited = await waitForHealth();
log(`gateway healthy after ${Math.round(waited / 1000)} s`);
log(`provider ${config.provider.name}: ${await ensureProvider()}`);
const keys = [];
for (const vk of config.virtualKeys) keys.push(await createVirtualKey(vk));
if (args.out) await writeFile(args.out, JSON.stringify({ baseUrl, keys }, null, 2), { mode: 0o600 });
for (const k of keys) {
  // Demo keys are generated per run for a local, mock-only gateway.
  console.log(args.quiet ? `${k.name}: …${k.value.slice(-4)}` : `${k.name}: ${k.value}`);
}
