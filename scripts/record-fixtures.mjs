// Records quota-endpoint fixtures from a running demo stack (see demo/).
// Key values are redacted to their last 4 characters before anything is written.
// Usage: BIFROST_URL=… BIFROST_SETUP_TOKEN=… node scripts/record-fixtures.mjs --keys keys.json [--out test/fixtures] [--requests 6]
//        [--only quota-200-after-traffic,quota-200-override] (record only the named fixtures)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    keys: { type: 'string' },
    out: { type: 'string', default: 'test/fixtures' },
    requests: { type: 'string', default: '6' },
    config: { type: 'string', default: new URL('../demo/demo.config.json', import.meta.url).pathname },
    only: { type: 'string' },
  },
});
if (!args.keys) { console.error('record-fixtures: --keys <seed output file> is required'); process.exit(2); }

const baseUrl = (process.env.BIFROST_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const setupToken = process.env.BIFROST_SETUP_TOKEN ?? '';
const { keys } = JSON.parse(await readFile(args.keys, 'utf8'));
const config = JSON.parse(await readFile(args.config, 'utf8'));
const models = config.provider.models.map((m) => `${config.provider.name}/${m}`);
const only = args.only ? new Set(args.only.split(',')) : null;
const wanted = (name) => !only || only.has(name);
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
  if (!wanted(name)) return;
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
if (wanted('quota-200-no-limits')) {
  const noLimit = await tempKey({ name: 'fixture-no-limits', provider_configs: [] });
  await save('quota-200-no-limits', await quota({ 'x-bf-vk': noLimit }));
}
if (wanted('quota-200-inactive')) {
  const inactive = await tempKey({ name: 'fixture-inactive', is_active: false, budgets: [{ max_limit: 2, reset_duration: '1d' }] });
  await save('quota-200-inactive', await quota({ 'x-bf-vk': inactive }));
}
if (wanted('quota-403-expired')) try {
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
    model: models[i % models.length],
    messages: [{ role: 'user', content: `fixture request ${i + 1}` }],
  });
  statuses.push(r.status);
  if (i === 0) report.push(`chat sample: HTTP ${r.status} ${JSON.stringify(redact(r.json)).slice(0, 240)}`);
}
// Usage, and the per-model rows even later, are written asynchronously: wait at least 15 s, then until every model shows.
const sentAt = Date.now();
let after;
do {
  await new Promise((r) => setTimeout(r, 1000));
  after = await quota({ 'x-bf-vk': primary.value });
} while (Date.now() - sentAt < 15_000 || ((after.json.budgets?.[0]?.per_model_usage ?? []).length < models.length && Date.now() - sentAt < 60_000));
report.push(`after traffic: recorded ${((Date.now() - sentAt) / 1000).toFixed(0)} s after the last request`);
await save('quota-200-after-traffic', after);

// An admin override on a budget: the gateway enforces max_limit + override_amount, but the quota response has no such field.
if (wanted('quota-200-override')) {
  const name = 'fixture-override';
  await tempKey({ name, budgets: [{ max_limit: 5, reset_duration: '1d' }] });
  const vk = (await admin('GET', '/api/governance/virtual-keys')).json.virtual_keys?.find((k) => k.name === name);
  const budgetId = vk?.budgets?.[0]?.id;
  const put = await admin('PUT', `/api/governance/virtual-keys/${vk?.id}/budgets/${budgetId}/override`, { amount: 5, mode: 'forever' });
  report.push(`override: HTTP ${put.status} ${JSON.stringify(redact(put.json)).slice(0, 300)}`);
  await save('quota-200-override', await quota({ 'x-bf-vk': vk?.value }));
}

console.log(JSON.stringify({
  gateway: version,
  traffic: { models, statuses },
  before: counters(before.json),
  after: counters(after.json),
  files: report,
}, null, 2));
