// `guard`: the pure decision (exit code + one sentence) and the bundled CLI as a child process against a local HTTP stand-in
// that answers with recorded gateway responses. The contract suite repeats the exit codes against the real gateway.
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guard, parseMinRemaining } from '../../src/cli/guard';
import { parseQuota, translator, type QuotaResult } from '../../src/core';
import { body, fixture } from './fixtures';

const en = translator('en');
const ms = translator('ms');
const NOW = Date.parse('2026-11-14T14:00:00Z');

function reading(mutate?: (b: Record<string, unknown>) => void): QuotaResult {
  const b = body('quota-200-after-traffic');
  mutate?.(b);
  const r = parseQuota(b);
  if (!r.ok) throw new Error(r.field);
  return { kind: 'ok', quota: r.value } as QuotaResult;
}
const budget = (b: Record<string, unknown>): Record<string, unknown> => (b.budgets as Record<string, unknown>[])[0]!;
/** One budget at `used` of $1 and no rate limit, so the budget is the closest limit. */
const usedBudget = (used: number) =>
  reading((b) => {
    Object.assign(budget(b), { max_limit: 1, current_usage: used, last_reset: '2026-11-14T13:00:00Z', reset_duration: '1d' });
    b.rate_limit = null;
    b.rate_limits = [];
  });

describe('guard decision', () => {
  it('goes while the closest limit has at least the asked share left, and says so in one sentence', () => {
    const out = guard(usedBudget(0.8), 20, NOW, en, 'en');
    expect(out).toEqual({ code: 0, text: 'Bifrost guard: go. Closest limit: 80% · $0.20 left · resets in 23h; at least 20% left is required.' });
  });
  it('stops below the asked share, naming what is left and when it resets', () => {
    const out = guard(usedBudget(0.81), 20, NOW, en, 'en');
    expect(out).toEqual({ code: 2, text: 'Bifrost guard: stop. Closest limit: 81% · $0.19 left · resets in 23h; at least 20% left is required.' });
  });
  it('stops when the limit is used up, even with no minimum asked', () => {
    expect(guard(usedBudget(1), 0, NOW, en, 'en')).toEqual({
      code: 2,
      text: 'Bifrost guard: stop. Closest limit: Budget used up · resets in 23h; at least 0% left is required.',
    });
    expect(guard(usedBudget(0.999), 0, NOW, en, 'en').code).toBe(0);
  });
  it('uses the strictest limit, here the request rate limit', () => {
    const r = reading((b) => {
      Object.assign(budget(b), { max_limit: 10, current_usage: 1 });
      Object.assign(b.rate_limit as Record<string, unknown>, { request_max_limit: 10, request_current_usage: 10, request_last_reset: '2026-11-14T13:59:30Z' });
      b.rate_limits = [b.rate_limit];
    });
    const out = guard(r, 5, NOW, en, 'en');
    expect(out.code).toBe(2);
    expect(out.text).toMatch(/^Bifrost guard: stop\. Closest limit: Requests used up/);
  });
  it('goes for a key with no limit and stops for an inactive key', () => {
    const none = fixture('quota-200-no-limits');
    const inactive = fixture('quota-200-inactive');
    const ok = (f: { body: unknown }): QuotaResult => {
      const r = parseQuota(f.body);
      if (!r.ok) throw new Error(r.field);
      return { kind: 'ok', quota: r.value } as QuotaResult;
    };
    expect(guard(ok(none), 50, NOW, en, 'en')).toEqual({ code: 0, text: 'Bifrost guard: go. No limit.' });
    expect(guard(ok(inactive), 0, NOW, en, 'en')).toEqual({ code: 2, text: 'Bifrost guard: stop. Key inactive.' });
  });
  it('returns 1 with a named reason when the quota cannot be read', () => {
    expect(guard({ kind: 'noKey' } as QuotaResult, 0, NOW, en, 'en')).toEqual({ code: 1, text: 'Bifrost guard: no key. Set BIFROST_VIRTUAL_KEY in the environment.' });
    expect(guard({ kind: 'unauthorized', status: 401 } as QuotaResult, 0, NOW, en, 'en')).toEqual({ code: 1, text: 'Bifrost guard: cannot read the quota (Key rejected).' });
    expect(guard({ kind: 'offline', reason: 'ECONNREFUSED' } as QuotaResult, 0, NOW, en, 'en').text).toBe('Bifrost guard: cannot read the quota (Gateway offline).');
  });
  it('speaks Malay from the same keys', () => {
    expect(guard(usedBudget(0.81), 20, NOW, ms, 'ms').text).toMatch(/^Bifrost guard: berhenti\. Had paling hampir: .+; baki sekurang-kurangnya 20% diperlukan\.$/);
  });
  it('is always one line', () => {
    for (const used of [0, 0.5, 0.95, 1, 2]) expect(guard(usedBudget(used), 10, NOW, en, 'en').text).not.toContain('\n');
  });
});

describe('--min-remaining', () => {
  it('defaults to 0 and reads both spellings, with or without %', () => {
    expect(parseMinRemaining([])).toEqual({ ok: true, value: 0 });
    expect(parseMinRemaining(['--min-remaining', '20'])).toEqual({ ok: true, value: 20 });
    expect(parseMinRemaining(['--min-remaining=12.5%'])).toEqual({ ok: true, value: 12.5 });
  });
  it('rejects values that are not a percent', () => {
    for (const bad of [['--min-remaining'], ['--min-remaining', 'abc'], ['--min-remaining=-1'], ['--min-remaining', '101']]) {
      expect(parseMinRemaining(bad).ok).toBe(false);
    }
  });
});

const KEY = ['sk', 'bf', 'cli0guard0value0wxyz9876'].join('-');
let dir: string;
let script: string;
let http: Server;
let baseUrl: string;
let answer = 'quota-200-after-traffic';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bifrost-meter-cli-'));
  script = join(dir, 'cli.js');
  await build({ entryPoints: ['src/cli/cli.ts'], outfile: script, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'error' });
  http = createServer((req, res) => {
    const f = req.headers['x-bf-vk'] === KEY ? fixture(answer) : fixture('quota-401-unknown-key');
    res.writeHead(f.status, { 'content-type': 'application/json' }).end(JSON.stringify(f.body));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => http?.close(r));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[], key = KEY): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { PATH: process.env.PATH ?? '', BIFROST_METER_LANGUAGE: 'en', BIFROST_BASE_URL: baseUrl, BIFROST_VIRTUAL_KEY: key, BIFROST_ALLOW_INSECURE_HTTP: '1' };
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { env, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

describe('node dist/cli.js guard', () => {
  it('exits 0 with plenty left and 2 when the asked share is not left, printing one line and never the key', async () => {
    answer = 'quota-200-after-traffic';
    const go = await cli(['guard', '--min-remaining', '1']);
    expect(go.code).toBe(0);
    expect(go.stdout).toMatch(/^Bifrost guard: go\. [^\n]+\n$/);
    const stop = await cli(['guard', '--min-remaining', '100']);
    expect(stop.code).toBe(2);
    expect(stop.stdout).toMatch(/^Bifrost guard: stop\. [^\n]+\n$/);
    for (const r of [go, stop]) expect(r.stdout + r.stderr).not.toContain(KEY);
  });
  it('exits 1 for a rejected key and for a bad argument, on stderr', async () => {
    const rejected = await cli(['guard'], ['sk', 'bf', 'cli0guard0unknown0000'].join('-'));
    expect(rejected).toEqual({ code: 1, stdout: '', stderr: 'Bifrost guard: cannot read the quota (Key rejected).\n' });
    const bad = await cli(['guard', '--min-remaining', 'lots']);
    expect(bad).toEqual({ code: 1, stdout: '', stderr: 'Bifrost guard: --min-remaining needs a percent from 0 to 100, got "lots".\n' });
  });
  it('keeps status working as before', async () => {
    const r = await cli(['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Bifrost /);
  });
});
