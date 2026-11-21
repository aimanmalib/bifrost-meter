// Cost of the quota endpoint as the gateway's request log grows.
// Starts the pinned demo gateway and mock upstream (demo/docker-compose.yml) on a free 127.0.0.1 port, seeds one
// virtual key from demo/log-volume/config.json, then for each log size fills the log with mock requests through that
// key and times quota reads: a sequential run and a burst of concurrent reads. The stack is always removed (`down -v`).
// Usage: node scripts/log-volume.mjs [--config demo/log-volume/config.json] [--levels 0,10000] [--mem-limit 3g] [--out result.json]
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: join(root, 'demo/log-volume/config.json') },
    levels: { type: 'string' },
    'mem-limit': { type: 'string' },
    out: { type: 'string' },
  },
});
const config = JSON.parse(await readFile(args.config, 'utf8'));
const levels = (args.levels ? args.levels.split(',').map(Number) : config.levels).sort((a, b) => a - b);
const log = (msg) => console.error(`log-volume: ${msg}`);

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

function summary(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const r = (n) => Math.round(n * 10) / 10;
  return { reads: s.length, p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), max: r(s.at(-1) ?? NaN) };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = Number(process.env.BIFROST_METER_LOGVOL_PORT) || (await freePort());
const setupToken = randomBytes(24).toString('hex');
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, COMPOSE_PROJECT_NAME: `bifrost-meter-logvol-${process.pid}`, BIFROST_PORT: String(port), BIFROST_SETUP_TOKEN: setupToken };
const tmp = await mkdtemp(join(tmpdir(), 'bifrost-meter-logvol-'));
// The demo caps the gateway at the memory limit in demo/docker-compose.yml, and its request log lives in tmpfs inside that
// cap. `--mem-limit` (or `gatewayMemLimit` in the config) raises it for a run, so the trend can be read past the cap.
const memLimit = args['mem-limit'] ?? config.gatewayMemLimit ?? null;
const files = ['-f', join(root, 'demo/docker-compose.yml')];
if (memLimit) {
  await writeFile(join(tmp, 'mem.yml'), `services:\n  bifrost-meter-gateway:\n    mem_limit: ${JSON.stringify(memLimit)}\n`);
  files.push('-f', join(tmp, 'mem.yml'));
}
const compose = (...a) => run('docker', ['compose', ...files, ...a], { env, timeout: 280_000 });
let tornDown = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  await compose('down', '-v', '--remove-orphans').catch((e) => log(`down -v failed: ${e.message}`));
  await rm(tmp, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => teardown().finally(() => process.exit(130)));

async function loggedRequests() {
  const res = await fetch(`${baseUrl}/api/logs/stats`, { headers: { 'x-bifrost-setup-token': setupToken } });
  if (!res.ok) throw new Error(`log stats: HTTP ${res.status}`);
  return (await res.json()).total_requests ?? 0;
}

async function fill(key, count) {
  let next = 0;
  let failed = 0;
  const models = config.provider.models;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bf-vk': key },
        body: JSON.stringify({ model: models[i % models.length], messages: [{ role: 'user', content: 'Log volume check for Bifrost Meter.' }] }),
      }).catch(() => null);
      if (!res?.ok) failed++;
      await res?.text();
    }
  };
  await Promise.all(Array.from({ length: config.fillConcurrency }, worker));
  return failed;
}

async function settle(expected) {
  const deadline = Date.now() + config.settleTimeoutSeconds * 1000;
  let seen = await loggedRequests();
  while (seen < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    seen = await loggedRequests();
  }
  return seen;
}

// A failed read is counted, not thrown: a gateway that drops connections under load is part of the measurement.
async function quotaRead(key) {
  const t = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/governance/virtual-keys/quota`, { headers: { 'x-bf-vk': key } });
    await res.text();
    return { ms: performance.now() - t, error: res.status === 200 ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ms: performance.now() - t, error: e.cause?.code ?? e.message };
  }
}

function readSummary(reads) {
  const errors = reads.filter((r) => r.error).map((r) => r.error);
  return { ...summary(reads.filter((r) => !r.error).map((r) => r.ms)), failed: errors.length, errors: [...new Set(errors)] };
}

async function gatewayState() {
  const name = `${env.COMPOSE_PROJECT_NAME}-bifrost-meter-gateway-1`;
  const { stdout } = await run('docker', ['inspect', '--format', '{{json .State}}', name], { timeout: 30_000 }).catch(() => ({ stdout: 'null' }));
  const st = JSON.parse(stdout);
  return st && { status: st.Status, oomKilled: st.OOMKilled, exitCode: st.ExitCode, startedAt: st.StartedAt };
}

async function gatewayMemory() {
  const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}}'], { timeout: 30_000 });
  return stdout.split('\n').find((l) => l.startsWith(`${env.COMPOSE_PROJECT_NAME}-bifrost-meter-gateway`))?.split(' ').slice(1).join(' ') ?? null;
}

const result = { gateway: null, startedAt: new Date().toISOString(), gatewayMemLimit: memLimit ?? 'compose default', config: { ...config, provider: undefined, virtualKeys: undefined }, levels: [] };
try {
  await compose('up', '-d', '--wait', 'bifrost-meter-gateway', 'bifrost-meter-mock-upstream');
  const keysFile = join(tmp, 'keys.json');
  await run(process.execPath, [join(root, 'demo/seed/seed.mjs'), '--config', args.config, '--out', keysFile, '--quiet'], {
    env: { ...env, BIFROST_URL: baseUrl },
    timeout: 200_000,
  });
  const key = JSON.parse(await readFile(keysFile, 'utf8')).keys[0].value;
  result.gateway = await (await fetch(`${baseUrl}/api/version`)).text().catch(() => null);
  let sent = 0;
  for (const level of levels) {
    const started = Date.now();
    const failed = level > sent ? await fill(key, level - sent) : 0;
    const fillSeconds = Math.round((Date.now() - started) / 1000);
    sent = Math.max(sent, level);
    const logged = await settle(sent);
    log(`level ${level}: ${logged} requests in the log (${failed} fill failures, ${Math.round((Date.now() - started) / 1000)} s)`);
    const seq = [];
    for (let i = 0; i < config.sequentialReads; i++) seq.push(await quotaRead(key));
    const memoryBeforeBurst = await gatewayMemory();
    const burstStart = performance.now();
    const burst = await Promise.all(Array.from({ length: config.concurrentReads }, () => quotaRead(key)));
    const burstWallMs = Math.round(performance.now() - burstStart);
    const memory = await gatewayMemory();
    const state = await gatewayState();
    const entry = { level, logged, fillFailures: failed, fillSeconds, hostLoad1m: Math.round(loadavg()[0] * 10) / 10, sequential: readSummary(seq), concurrent: { ...readSummary(burst), wallMs: burstWallMs }, gatewayMemoryBeforeBurst: memoryBeforeBurst, gatewayMemoryAfter: memory, gatewayState: state };
    result.levels.push(entry);
    log(`level ${level}: sequential p50 ${entry.sequential.p50} ms p95 ${entry.sequential.p95} ms (${entry.sequential.failed} failed); concurrent p50 ${entry.concurrent.p50} ms p95 ${entry.concurrent.p95} ms (${entry.concurrent.failed} failed); gateway ${JSON.stringify(state)} ${memory}`);
    if (args.out) await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`);
    if (state?.status !== 'running' || state.oomKilled) {
      log(`gateway is not running after level ${level}; later levels skipped`);
      break;
    }
  }
} finally {
  await teardown();
}
console.log(JSON.stringify(result, null, 2));
