// Gateway side of the agent evaluation: starts the pinned demo stack (official Bifrost image + labelled mock upstream),
// creates one virtual key per state with the demo seed, and drives each key to its state with real requests through the
// gateway. Nothing here fakes a quota response.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export async function startStack(root, cfg) {
  const port = await freePort();
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: cfg.composeProject,
    BIFROST_PORT: String(port),
    BIFROST_SETUP_TOKEN: randomBytes(24).toString('hex'),
  };
  const compose = ['compose', '-p', cfg.composeProject, '-f', join(root, 'demo/docker-compose.yml')];
  await run('docker', [...compose, 'up', '-d', 'bifrost-meter-gateway', 'bifrost-meter-mock-upstream'], { env });
  const stack = { baseUrl: `http://127.0.0.1:${port}`, env, compose };
  stack.down = () => run('docker', [...compose, 'down', '-v', '--remove-orphans'], { env });
  return stack;
}

/** Runs demo/seed/seed.mjs with a generated config and returns name → key value. */
export async function seedKeys(root, stack, provider, virtualKeys, dir) {
  const cfgFile = join(dir, `seed-${Date.now()}.json`);
  const outFile = join(dir, 'keys.json');
  await writeFile(cfgFile, JSON.stringify({ provider, virtualKeys }), { mode: 0o600 });
  await run(process.execPath, [join(root, 'demo/seed/seed.mjs'), '--config', cfgFile, '--out', outFile, '--quiet'], {
    env: { ...stack.env, BIFROST_URL: stack.baseUrl },
  });
  const { keys } = JSON.parse(await readFile(outFile, 'utf8'));
  return new Map(keys.map((k) => [k.name, k.value]));
}

export async function chat(stack, key, model) {
  const res = await fetch(`${stack.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bf-vk': key },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Agent evaluation traffic.' }] }),
  });
  await res.text();
  return res.status;
}

export async function quota(stack, key) {
  const res = await fetch(`${stack.baseUrl}/api/governance/virtual-keys/quota`, { headers: { 'x-bf-vk': key } });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

/** Usage is written after the response (measured lag 2 to 6 s): poll until the reading has not changed for 8 s. */
export async function settledQuota(stack, key) {
  let last = '';
  let since = Date.now();
  const started = Date.now();
  for (;;) {
    const q = await quota(stack, key);
    const now = JSON.stringify(q.json?.budgets?.map((b) => b.current_usage) ?? []) + JSON.stringify(q.json?.rate_limit ?? null);
    if (now !== last) {
      last = now;
      since = Date.now();
    }
    if (Date.now() - since >= 8000 || Date.now() - started > 60000) return q;
    await sleep(1000);
  }
}

/** Cost of one mock request in USD, measured on a probe key. */
export async function costPerRequest(root, stack, cfg, dir) {
  const keys = await seedKeys(root, stack, cfg.provider, [{ name: 'eval-probe', budgets: [{ max_limit: 100, reset_duration: cfg.resetDuration }] }], dir);
  const key = keys.get('eval-probe');
  const n = 5;
  for (let i = 0; i < n; i++) {
    const status = await chat(stack, key, cfg.trafficModel);
    if (status !== 200) throw new Error(`probe request failed: HTTP ${status}`);
  }
  const q = await settledQuota(stack, key);
  const used = q.json?.budgets?.[0]?.current_usage ?? 0;
  if (!(used > 0)) throw new Error('probe requests did not move the budget');
  return used / n;
}

/** Virtual key definitions for every state that needs a key on the gateway. */
export function stateKeys(states, cfg, perRequest) {
  const out = [];
  for (const s of states) {
    if (s.kind === 'budget') {
      out.push({ name: `eval-${s.id}`, budgets: [{ max_limit: Number((perRequest * cfg.budgetRequests).toPrecision(6)), reset_duration: cfg.resetDuration }] });
    } else if (s.kind === 'requests') {
      out.push({ name: `eval-${s.id}`, rate_limit: { request_max_limit: s.requestLimit, request_reset_duration: cfg.resetDuration } });
    }
  }
  return out;
}

/** Sends real requests until the key reaches its state. Returns the number sent and the number the gateway blocked. */
export async function driveState(stack, key, state, cfg) {
  let sent = 0;
  let blocked = 0;
  if (state.kind === 'requests') {
    for (; sent < state.requests; sent++) await chat(stack, key, cfg.trafficModel);
    return { sent, blocked };
  }
  const target = Math.round((cfg.budgetRequests * state.usedPercent) / 100);
  for (; sent < target; sent++) await chat(stack, key, cfg.trafficModel);
  if (state.usedPercent < 100) return { sent, blocked };
  // Used up: keep sending, letting the usage settle between requests, until the gateway blocks one.
  for (let i = 0; i < 10 && blocked === 0; i++) {
    await settledQuota(stack, key);
    if ((await chat(stack, key, cfg.trafficModel)) === 200) sent++;
    else blocked++;
  }
  return { sent, blocked };
}
