// Steady mock traffic for the Bifrost Meter demo, so the meter moves.
// Looks up a demo virtual key by name (setup token), then sends chat completions
// through the gateway. Every reply comes from the mock upstream; no real model is called.
// Usage: node demo/traffic/traffic.mjs [--config demo/demo.config.json] [--requests N] [--interval S] [--key NAME]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: new URL('../demo.config.json', import.meta.url).pathname },
    requests: { type: 'string' },
    interval: { type: 'string' },
    key: { type: 'string' },
  },
});

const baseUrl = (process.env.BIFROST_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const setupToken = process.env.BIFROST_SETUP_TOKEN;
if (!setupToken) {
  console.error('traffic: BIFROST_SETUP_TOKEN is not set (the same value the gateway container uses).');
  process.exit(2);
}
const config = JSON.parse(await readFile(args.config, 'utf8'));
const t = config.traffic ?? {};
const keyName = args.key ?? t.keyName ?? config.virtualKeys[0].name;
const total = Number(args.requests ?? t.requests ?? 0); // 0 = run until stopped
const intervalMs = Number(args.interval ?? t.intervalSeconds ?? 5) * 1000;
const model = t.model ?? `${config.provider.name}/${config.provider.models[0]}`;
const log = (msg) => console.error(`traffic: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findKey() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/governance/virtual-keys`, { headers: { 'x-bifrost-setup-token': setupToken } });
      if (res.ok) {
        const found = (await res.json()).virtual_keys?.find((k) => k.name === keyName);
        if (found?.value) return found.value;
      }
    } catch { /* gateway not up yet */ }
    await sleep(3000);
  }
  throw new Error(`virtual key "${keyName}" not found at ${baseUrl}; run the seed first`);
}

const key = await findKey();
log(`sending ${total || 'unlimited'} request(s) as "${keyName}" (…${key.slice(-4)}) every ${intervalMs / 1000} s`);
let stop = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true; });
let sent = 0;
let failed = 0;
while (!stop && (total === 0 || sent + failed < total)) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bf-vk': key },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Demo traffic for Bifrost Meter.' }] }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  if (res.ok) {
    sent++;
    await res.text();
  } else {
    failed++;
    // A blocked request (budget or rate limit reached) is part of the demo; log it and keep going.
    log(`request blocked: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  if (total === 0 || sent + failed < total) await sleep(intervalMs);
}
log(`done: ${sent} ok, ${failed} blocked`);
console.log(JSON.stringify({ sent, failed }));
