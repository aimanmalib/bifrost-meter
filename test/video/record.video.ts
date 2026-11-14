// Records the demo video: one continuous browser recording of the packaged extension in code-server against the
// pinned gateway, seeded from demo/recording.config.json. Every number on screen comes from the running gateway; the
// script only sends mock traffic and runs editor commands. It writes the raw video, a scene log (start and end of each
// scene in video time) and three screenshots; scripts/cut-demo.mjs cuts the scenes and burns the captions.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { fetchQuota, normalize, strictest, translator, type QuotaResponse } from '../../src/core';
import { readSettings } from '../../src/extension/settings';
import { connect, textOf } from '../unit/mcp-client';
import { command, nls, setKey } from '../e2e/editor';
import { compose, root, writeSettings, type E2eStack } from '../e2e/stack';

const run = promisify(execFile);
const stack = JSON.parse(process.env.BIFROST_METER_E2E ?? '{}') as E2eStack;
const env = { ...process.env, ...stack.vars };
const configPath = join(root, 'demo/recording.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as RecordingFile;
const rec = config.recording;
const out = join(root, 'out/recording');
const images = join(root, 'docs/images');
const defaults = readSettings(() => undefined);
const t = translator('en');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RecordingFile {
  traffic: { keyName: string };
  recording: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    editorSettings: Record<string, unknown>;
    sampleFile: { name: string; text: string };
    warmup: { minSeconds: number; intervalSeconds: number };
    steps: { first: number; warn: number };
    mcpFile: string;
  };
}

const keyValue = (): string => {
  const k = stack.keys.find((x) => x.name === config.traffic.keyName);
  if (!k) throw new Error(`seed did not return key ${config.traffic.keyName}`);
  return k.value;
};

async function quota(): Promise<QuotaResponse> {
  const r = await fetchQuota({ baseUrl: stack.baseUrl, key: keyValue(), allowInsecureHttp: true });
  if (r.kind !== 'ok') throw new Error(`expected 200 quota, got ${r.kind}`);
  return r.quota;
}

/** The status bar's limit: percent used and the cost of one request measured so far. */
async function usage(): Promise<{ percent: number; requests: number; perRequest: number; limitUsd: number }> {
  const q = await quota();
  const top = strictest(normalize(q, Date.now()).limits, defaults.metric);
  const budget = q.budgets?.[0];
  const requests = q.rate_limit?.request_current_usage ?? 0;
  const used = budget?.current_usage ?? 0;
  return { percent: top?.percent ?? 0, requests, perRequest: requests > 0 ? used / requests : 0, limitUsd: budget?.max_limit ?? 0 };
}

/** Mock traffic through the gateway; returns the traffic tool's summary ({ sent, failed }). */
async function traffic(requests: number, intervalSeconds: number): Promise<{ sent: number; failed: number }> {
  const { stdout } = await run(
    process.execPath,
    [join(root, 'demo/traffic/traffic.mjs'), '--config', configPath, '--requests', String(requests), '--interval', String(intervalSeconds)],
    { env: { ...env, BIFROST_URL: stack.baseUrl, BIFROST_SETUP_TOKEN: stack.setupToken }, timeout: 400_000 },
  );
  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { sent: number; failed: number };
}

/** Waits until the gateway has counted `count` requests (usage is written a few seconds after each request). */
async function counted(count: number): Promise<void> {
  const until = Date.now() + 40_000;
  while ((await usage()).requests < count && Date.now() < until) await sleep(500);
}

/** Sends enough requests to bring the strictest limit to `target` percent, then waits until the gateway counts them. */
async function trafficTo(target: number): Promise<void> {
  const now = await usage();
  const n = Math.max(1, Math.ceil(((target - now.percent) / 100) * (now.limitUsd / now.perRequest)));
  await traffic(n, 0.05);
  await counted(now.requests + n);
}

async function writeFile(name: string, text: string): Promise<void> {
  await compose(env, ['exec', '-T', 'bifrost-meter-code-server', 'sh', '-c', `cat > "/home/coder/${name}"`], text);
}

async function open(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+P');
  const input = page.locator('.quick-input-widget input');
  await input.fill(name);
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.tab', { hasText: name })).toBeVisible();
}

test('records the demo', async ({ browser }) => {
  mkdirSync(out, { recursive: true });
  mkdirSync(images, { recursive: true });
  await writeSettings(env, rec.editorSettings);
  await writeFile(rec.sampleFile.name, rec.sampleFile.text);

  const context = await browser.newContext({
    viewport: rec.viewport,
    deviceScaleFactor: rec.deviceScaleFactor,
    // Recorded at the viewport size (Playwright does not scale up); scripts/cut-demo.mjs scales to the output size.
    recordVideo: { dir: out, size: rec.viewport },
  });
  const t0 = Date.now();
  const scenes: Record<string, { start: number; end: number }> = {};
  const scene = async (id: string, body: () => Promise<void>) => {
    const start = (Date.now() - t0) / 1000;
    await body();
    scenes[id] = { start, end: (Date.now() - t0) / 1000 };
  };
  const page = await context.newPage();
  const item = () => page.locator('[id$="bifrostMeter.status"]');
  const shot = (name: string) => page.screenshot({ path: join(images, `demo-${name}.png`) });

  await page.goto(`${stack.editorUrl}/?folder=/home/coder`);
  await expect(page.locator('.statusbar')).toBeVisible({ timeout: 90_000 });
  await open(page, rec.sampleFile.name);
  await expect(item()).toContainText(t('state.unconfigured'), { timeout: 150_000 });
  await sleep(1000);

  await scene('setKey', async () => {
    await setKey(page, keyValue());
    await expect(item()).toContainText(' left', { timeout: 30_000 });
    await sleep(4000);
  });

  // Slow traffic so the extension has two minutes of samples: the forecast needs them (MIN_SPAN_MS).
  const warmStarted = Date.now();
  const w = rec.warmup;
  const warmRequests = Math.ceil(w.minSeconds / w.intervalSeconds);
  await traffic(warmRequests, w.intervalSeconds);
  while (Date.now() - warmStarted < w.minSeconds * 1000) await sleep(1000);
  await counted(warmRequests);
  await command(page, nls['command.refresh']);
  await sleep(3000);

  await scene('intro', async () => {
    await page.mouse.move(rec.viewport.width / 2, rec.viewport.height / 3);
    await sleep(7000);
  });

  await trafficTo(rec.steps.first);
  await scene('traffic', async () => {
    await sleep(1500);
    await command(page, nls['command.refresh']);
    await sleep(8000);
  });
  await shot('ok');

  await scene('tooltip', async () => {
    // The status bar hover opens on mouse movement into the item; move away first, then in.
    const hover = page.locator('.monaco-hover:not(.hidden)');
    await expect(async () => {
      await page.mouse.move(rec.viewport.width / 2, rec.viewport.height / 2);
      await item().hover();
      await expect(hover.first()).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await sleep(8000);
  });

  await scene('panel', async () => {
    await item().click();
    await expect(page.locator('.tab', { hasText: t('tooltip.title') })).toBeVisible();
    await sleep(3500);
    // Scroll the panel down to spend by model.
    await page.mouse.move(rec.viewport.width / 2, rec.viewport.height / 2);
    await page.mouse.wheel(0, rec.viewport.height / 2);
    await sleep(5000);
  });

  await trafficTo(rec.steps.warn);
  await scene('warning', async () => {
    await sleep(1500);
    await command(page, nls['command.refresh']);
    await expect(item()).toHaveClass(/warning-kind|has-background-color/, { timeout: 30_000 });
    await expect(page.locator('.notifications-toasts')).toContainText(' used, ', { timeout: 30_000 });
    await sleep(1500);
    await shot('warning');
    await sleep(8000);
  });

  // Past the budget: the gateway refuses the rest, and the meter shows the limit as used up.
  const before = await usage();
  const rest = Math.ceil(((100 - before.percent) / 100) * (before.limitUsd / before.perRequest)) + 3;
  const result = await traffic(rest, 0.05);
  expect(result.failed).toBeGreaterThan(0);
  await sleep(6000);
  await scene('exhausted', async () => {
    await sleep(1500);
    await command(page, nls['command.refresh']);
    await expect(item()).toHaveAttribute('aria-label', new RegExp(t('state.exhausted')), { timeout: 30_000 });
    await sleep(1500);
    await shot('exhausted');
    await sleep(7000);
  });

  // The MCP tool, called over stdio with the official SDK client against the same gateway; its output goes into
  // the editor as a file, unchanged.
  const { client } = await connect(join(root, 'dist/mcp.js'), {
    BIFROST_BASE_URL: stack.baseUrl,
    BIFROST_VIRTUAL_KEY: keyValue(),
    BIFROST_ALLOW_INSECURE_HTTP: 'true',
  });
  const res = await client.callTool({ name: 'get_budget_status', arguments: {} });
  await client.close();
  const body = JSON.stringify({ tool: 'get_budget_status', structuredContent: res.structuredContent, text: textOf(res) }, null, 2);
  expect(body).not.toContain(keyValue());
  await writeFile(rec.mcpFile, `${body}\n`);
  await scene('mcp', async () => {
    await open(page, rec.mcpFile);
    await sleep(10_000);
  });

  await context.close();
  await page.video()?.saveAs(join(out, 'raw.webm'));
  await page.video()?.delete();
  writeFileSync(join(out, 'scenes.json'), JSON.stringify({ scenes }, null, 2));
});
