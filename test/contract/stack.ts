// Global setup for the contract suite: starts the demo gateway and mock upstream from demo/docker-compose.yml
// on a free 127.0.0.1 port, seeds the demo keys, and always tears the stack down (`down -v`) afterwards.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';

const run = promisify(execFile);
const root = new URL('../..', import.meta.url).pathname;
const composeFile = join(root, 'demo/docker-compose.yml');

export interface ContractStack {
  skip: string | null;
  baseUrl: string;
  setupToken: string;
  keys: { name: string; value: string }[];
  root: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    contract: ContractStack;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function dockerReady(): Promise<string | null> {
  try {
    await run('docker', ['compose', 'version'], { timeout: 20_000 });
    await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 20_000 });
    return null;
  } catch {
    return 'Docker with the compose plugin is not available; contract tests skipped (they need the pinned gateway image).';
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const empty: ContractStack = { skip: null, baseUrl: '', setupToken: '', keys: [], root };
  const skip = await dockerReady();
  if (skip) {
    console.warn(`\n[contract] ${skip}\n`);
    project.provide('contract', { ...empty, skip });
    return async () => {};
  }

  const port = Number(process.env.BIFROST_METER_CONTRACT_PORT) || (await freePort());
  const setupToken = randomBytes(24).toString('hex');
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: `bifrost-meter-contract-${process.pid}`,
    BIFROST_PORT: String(port),
    BIFROST_SETUP_TOKEN: setupToken,
  };
  const compose = (...args: string[]) => run('docker', ['compose', '-f', composeFile, ...args], { env, timeout: 280_000 });
  const tmp = await mkdtemp(join(tmpdir(), 'bifrost-meter-contract-'));
  const teardown = async () => {
    await compose('down', '-v', '--remove-orphans').catch((e: Error) => console.warn(`[contract] down -v failed: ${e.message}`));
    await rm(tmp, { recursive: true, force: true });
  };

  try {
    const started = Date.now();
    await compose('up', '-d', '--wait', 'bifrost-meter-gateway', 'bifrost-meter-mock-upstream');
    const baseUrl = `http://127.0.0.1:${port}`;
    const keysFile = join(tmp, 'keys.json');
    await run(process.execPath, [join(root, 'demo/seed/seed.mjs'), '--out', keysFile, '--quiet'], {
      env: { ...env, BIFROST_URL: baseUrl },
      timeout: 200_000,
    });
    const { keys } = JSON.parse(await readFile(keysFile, 'utf8')) as { keys: ContractStack['keys'] };
    console.warn(`[contract] gateway up and seeded on 127.0.0.1:${port} in ${Math.round((Date.now() - started) / 1000)} s`);
    project.provide('contract', { skip: null, baseUrl, setupToken, keys, root });
  } catch (e) {
    await teardown();
    throw e;
  }
  return teardown;
}
