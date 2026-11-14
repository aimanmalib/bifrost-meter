// Global setup for the end-to-end suite: the demo gateway, mock upstream and code-server (with the packaged .vsix
// installed) on free 127.0.0.1 ports. Seeds the demo keys and always removes the stack (`docker compose down -v`).
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const root = resolve(__dirname, '../..');
const files = ['-f', join(root, 'demo/docker-compose.yml'), '-f', join(root, 'test/e2e/docker-compose.e2e.yml')];

export interface E2eStack {
  project: string;
  baseUrl: string;
  editorUrl: string;
  setupToken: string;
  keys: { name: string; value: string }[];
  /** Compose variables; merge with process.env before calling compose. */
  vars: Record<string, string>;
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

export function compose(env: NodeJS.ProcessEnv, args: string[], input?: string) {
  const child = run('docker', ['compose', ...files, ...args], { env, timeout: 280_000 });
  if (input !== undefined) {
    child.child.stdin?.end(input);
  }
  return child;
}

/** Writes the code-server user settings before the browser opens the editor. */
export async function writeSettings(env: NodeJS.ProcessEnv, settings: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(
    {
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'extensions.ignoreRecommendations': true,
      'window.commandCenter': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'bifrostMeter.pollIntervalSeconds': 15,
      ...settings,
    },
    null,
    2,
  );
  const target = '/home/coder/.local/share/code-server/User/settings.json';
  await compose(env, ['exec', '-T', 'bifrost-meter-code-server', 'sh', '-c', `mkdir -p "$(dirname ${target})" && cat > ${target}`], body);
}

export default async function setup(): Promise<() => Promise<void>> {
  const vsix = join(root, 'bifrost-meter.vsix');
  if (!existsSync(vsix)) throw new Error('bifrost-meter.vsix not found; run `npm run package` first (npm run test:e2e does).');
  const [gatewayPort, editorPort] = [await freePort(), await freePort()];
  const setupToken = randomBytes(24).toString('hex');
  const project = `bifrost-meter-e2e-${process.pid}`;
  const vars = {
    COMPOSE_PROJECT_NAME: project,
    BIFROST_PORT: String(gatewayPort),
    CODE_SERVER_PORT: String(editorPort),
    BIFROST_SETUP_TOKEN: setupToken,
    BIFROST_METER_VSIX: vsix,
  };
  const env = { ...process.env, ...vars };
  const tmp = await mkdtemp(join(tmpdir(), 'bifrost-meter-e2e-'));
  const teardown = async () => {
    await compose(env, ['down', '-v', '--remove-orphans']).catch((e: Error) => console.warn(`[e2e] down -v failed: ${e.message}`));
    await rm(tmp, { recursive: true, force: true });
  };
  try {
    const started = Date.now();
    await compose(env, ['up', '-d', '--wait', 'bifrost-meter-gateway', 'bifrost-meter-mock-upstream', 'bifrost-meter-code-server']);
    const baseUrl = `http://127.0.0.1:${gatewayPort}`;
    const keysFile = join(tmp, 'keys.json');
    // The demo recording seeds its own keys (demo/recording.config.json); the e2e suite uses the default demo config.
    const seedConfig = process.env.BIFROST_METER_SEED_CONFIG ? ['--config', process.env.BIFROST_METER_SEED_CONFIG] : [];
    await run(process.execPath, [join(root, 'demo/seed/seed.mjs'), ...seedConfig, '--out', keysFile, '--quiet'], {
      env: { ...env, BIFROST_URL: baseUrl },
      timeout: 200_000,
    });
    const { keys } = JSON.parse(await readFile(keysFile, 'utf8')) as { keys: E2eStack['keys'] };
    await writeSettings(env, { 'workbench.colorTheme': 'Default Dark Modern' });
    console.warn(`[e2e] gateway, mock upstream and code-server ready in ${Math.round((Date.now() - started) / 1000)} s`);
    const stack: E2eStack = { project, baseUrl, editorUrl: `http://127.0.0.1:${editorPort}`, setupToken, keys, vars };
    process.env.BIFROST_METER_E2E = JSON.stringify(stack);
  } catch (e) {
    await teardown();
    throw e;
  }
  return teardown;
}
