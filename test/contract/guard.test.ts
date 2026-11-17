// Contract: `node dist/cli.js guard` against the pinned gateway. A fresh demo key exits 0; a key whose request limit was used
// up by real traffic through the gateway exits 2. The run is kept in out/guard-run.txt (ignored by git) with the key
// shortened to its last 4 characters.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { fetchQuota } from '../../src/core';

const run = promisify(execFile);
const stack = inject('contract');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LIMIT = 3;
let dir = '';
const log: string[] = [];

async function guard(key: string, min: string): Promise<{ code: number; out: string }> {
  const env = { PATH: process.env.PATH ?? '', BIFROST_METER_LANGUAGE: 'en', BIFROST_BASE_URL: stack.baseUrl, BIFROST_VIRTUAL_KEY: key, BIFROST_ALLOW_INSECURE_HTTP: '1' };
  const args = [join(stack.root, 'dist/cli.js'), 'guard', '--min-remaining', min];
  const r = await run(process.execPath, args, { env, timeout: 30_000 }).then(
    (ok) => ({ code: 0, out: ok.stdout + ok.stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: Number(e.code ?? 1), out: `${e.stdout ?? ''}${e.stderr ?? ''}` }),
  );
  expect(r.out).not.toContain(key);
  log.push(`$ BIFROST_VIRTUAL_KEY=…${key.slice(-4)} node dist/cli.js guard --min-remaining ${min}`, r.out.trimEnd(), `exit ${r.code}`, '');
  return r;
}

describe.skipIf(Boolean(stack.skip))('guard on the pinned gateway', () => {
  beforeAll(async () => {
    await run(process.execPath, [join(stack.root, 'esbuild.mjs'), '--production'], { cwd: stack.root, timeout: 120_000 });
    dir = mkdtempSync(join(tmpdir(), 'bifrost-meter-guard-'));
  }, 180_000);
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (log.length > 0) {
      mkdirSync(join(stack.root, 'out'), { recursive: true });
      writeFileSync(join(stack.root, 'out/guard-run.txt'), log.join('\n'));
    }
  });

  it('exits 0 for a fresh demo key', async () => {
    const r = await guard(stack.keys[0]!.value, '10');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Bifrost guard: go\. [^\n]+\n$/);
  });

  it('exits 2 once real traffic has used up the request limit', async () => {
    const demo = JSON.parse(readFileSync(join(stack.root, 'demo/demo.config.json'), 'utf8')) as { provider: { name: string; models: string[] } };
    const cfgFile = join(dir, 'seed.json');
    const outFile = join(dir, 'keys.json');
    const virtualKeys = [{ name: 'contract-guard', rate_limit: { request_max_limit: LIMIT, request_reset_duration: '1h' } }];
    writeFileSync(cfgFile, JSON.stringify({ provider: demo.provider, virtualKeys }), { mode: 0o600 });
    await run(process.execPath, [join(stack.root, 'demo/seed/seed.mjs'), '--config', cfgFile, '--out', outFile, '--quiet'], {
      env: { ...process.env, BIFROST_URL: stack.baseUrl, BIFROST_SETUP_TOKEN: stack.setupToken },
      timeout: 120_000,
    });
    const { keys } = JSON.parse(readFileSync(outFile, 'utf8')) as { keys: { name: string; value: string }[] };
    const key = keys.find((k) => k.name === 'contract-guard')!.value;
    expect((await guard(key, '0')).code).toBe(0);

    const model = `${demo.provider.name}/${demo.provider.models[0]}`;
    for (let i = 0; i < LIMIT; i++) {
      const res = await fetch(`${stack.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bf-vk': key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Contract traffic for guard.' }] }),
      });
      await res.text();
      expect(res.status).toBe(200);
    }
    // Usage is written a few seconds after the response.
    for (let i = 0; i < 30; i++) {
      const q = await fetchQuota({ baseUrl: stack.baseUrl, key, allowInsecureHttp: true });
      if (q.kind === 'ok' && (q.quota.rate_limit?.request_current_usage ?? 0) >= LIMIT) break;
      await sleep(1000);
    }
    const r = await guard(key, '0');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/^Bifrost guard: stop\. Closest limit: Requests used up[^\n]*\n$/);
  });
});
