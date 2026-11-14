// Records quota-endpoint fixtures from a running demo stack (see demo/).
// Key values are redacted to their last 4 characters before anything is written.
// Usage: BIFROST_URL=… BIFROST_SETUP_TOKEN=… node scripts/record-fixtures.mjs --keys keys.json [--out test/fixtures] [--requests 5]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    keys: { type: 'string' },
    out: { type: 'string', default: 'test/fixtures' },
    requests: { type: 'string', default: '5' },
    model: { type: 'string', default: 'openai/gpt-4o-mini' },
  },
});
if (!args.keys) { console.error('record-fixtures: --keys <seed output file> is required'); process.exit(2); }

const baseUrl = (process.env.BIFROST_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const setupToken = process.env.BIFROST_SETUP_TOKEN ?? '';
const { keys } = JSON.parse(await readFile(args.keys, 'utf8'));
const primary = keys[0];
const secrets = new Set(keys.map((k) => k.value));

const redactValue = (v) => `sk-bf-…${v.slice(-4)}`;
function redact(node) {
  if (typeof node === 'string') {
    return secrets.has(node) || /^sk-bf-[A-Za-z0-9-]{8,}$/.test(node) ? redactValue(node) : node;
  }
  if (Array.isArray(node)) return node.map(redact);
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redact(v)]));
  return node;
}

async function call(method, path, headers = {}, body) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ms: Date.now() - started, json };
}
const quota = (headers) => call('GET', '/api/governance/virtual-keys/quota', headers);
const admin = (method, path, body) => call(method, path, { 'x-bifrost-setup-token': setupToken }, body);

const report = [];
async function save(name, res) {
  await mkdir(args.out, { recursive: true });
  const fixture = { recorded: { status: res.status, gateway: version }, body: redact(res.json) };
  await writeFile(`${args.out}/${name}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
  report.push(`${name}: HTTP ${res.status} in ${res.ms} ms`);
}

async function tempKey(body) {
  const res = await admin('POST', '/api/governance/virtual-keys', body);
  const value = res.json?.virtual_key?.value;
  if (!value) throw new Error(`temp key "${body.name}" failed: HTTP ${res.status} ${JSON.stringify(redact(res.json))}`);
  secrets.add(value);
  return value;
}

const counters = (b) => ({
  budget_usage: b.budgets?.map((x) => x.current_usage),
  per_model_usage: b.budgets?.map((x) => (x.per_model_usage ?? []).length),
  tokens: b.rate_limit?.token_current_usage ?? null,
  requests: b.rate_limit?.request_current_usage ?? null,
});

const version = (await call('GET', '/api/version')).json;
const before = await quota({ 'x-bf-vk': primary.value });
await save('quota-200-fresh', before);
await save('quota-401-missing-key', await quota({}));
await save('quota-401-unknown-key', await quota({ 'x-bf-vk': `sk-bf-${'0'.repeat(32)}` }));
await save('quota-200-bearer-header', await quota({ authorization: `Bearer ${primary.value}` }));

// Variants that need their own short-lived keys.
const noLimit = await tempKey({ name: 'fixture-no-limits', provider_configs: [] });
await save('quota-200-no-limits', await quota({ 'x-bf-vk': noLimit }));
const inactive = await tempKey({ name: 'fixture-inactive', is_active: false, budgets: [{ max_limit: 2, reset_duration: '1d' }] });
await save('quota-200-inactive', await quota({ 'x-bf-vk': inactive }));
try {
  const expiresAt = new Date(Date.now() + 3000).toISOString();
  const expiring = await tempKey({ name: 'fixture-expiring', expires_at: expiresAt, budgets: [{ max_limit: 2, reset_duration: '1d' }] });
  await new Promise((r) => setTimeout(r, 5000));
  await save('quota-403-expired', await quota({ 'x-bf-vk': expiring }));
} catch (err) {
  report.push(`quota-403-expired: not recorded (${err.message})`);
}

// Traffic through the primary key against the mock upstream.
const statuses = [];
for (let i = 0; i < Number(args.requests); i += 1) {
  const r = await call('POST', '/v1/chat/completions', { 'x-bf-vk': primary.value }, {
    model: args.model,
    messages: [{ role: 'user', content: `fixture request ${i + 1}` }],
  });
  statuses.push(r.status);
  if (i === 0) report.push(`chat sample: HTTP ${r.status} ${JSON.stringify(redact(r.json)).slice(0, 240)}`);
}
await new Promise((r) => setTimeout(r, 1500));
const after = await quota({ 'x-bf-vk': primary.value });
await save('quota-200-after-traffic', after);

console.log(JSON.stringify({
  gateway: version,
  traffic: { model: args.model, statuses },
  before: counters(before.json),
  after: counters(after.json),
  files: report,
}, null, 2));
