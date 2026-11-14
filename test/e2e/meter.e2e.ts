// End to end: the packaged .vsix inside code-server, against the pinned gateway and the mock upstream.
// Expected numbers are computed from the live quota response with the extension's own pure code, so the test checks
// that the status bar shows what the gateway reports, not fixed demo values.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { fetchQuota, formatPercent, normalize, strictest, translator, type QuotaResponse } from '../../src/core';
import { readSettings } from '../../src/extension/settings';
import { remainingText } from '../../src/extension/view';
import { root, type E2eStack } from './stack';

const run = promisify(execFile);
const stack = JSON.parse(process.env.BIFROST_METER_E2E ?? '{}') as E2eStack;
const env = { ...process.env, ...stack.vars };
const t = translator('en');
const defaults = readSettings(() => undefined);
const images = join(root, 'docs/images');
const nls = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(name: string): string {
  const k = stack.keys.find((x) => x.name === name);
  if (!k) throw new Error(`seed did not return key ${name}`);
  return k.value;
}

async function quota(value: string): Promise<QuotaResponse> {
  const r = await fetchQuota({ baseUrl: stack.baseUrl, key: value, allowInsecureHttp: true });
  if (r.kind !== 'ok') throw new Error(`expected 200 quota, got ${r.kind}`);
  return r.quota;
}

/** The percent and remaining amount the status bar must show for this quota response (default settings, English). */
function expected(q: QuotaResponse): { pct: string; left: string; percent: number } {
  const top = strictest(normalize(q, Date.now()).limits, defaults.metric);
  if (!top) throw new Error('quota response has no limit');
  return { pct: formatPercent(top.percent, 'en', t), left: remainingText(top, { t, lang: 'en' }), percent: top.percent };
}

async function traffic(name: string, requests: number): Promise<void> {
  const { stdout } = await run(
    process.execPath,
    [join(root, 'demo/traffic/traffic.mjs'), '--key', name, '--requests', String(requests), '--interval', '0.05'],
    { env: { ...env, BIFROST_URL: stack.baseUrl, BIFROST_SETUP_TOKEN: stack.setupToken }, timeout: 120_000 },
  );
  expect(JSON.parse(stdout.trim().split('\n').pop() ?? '{}')).toEqual({ sent: requests, failed: 0 });
}

/** Waits until the gateway shows at least `count` requests on the key (usage is written asynchronously). */
async function requestsAtLeast(value: string, count: number): Promise<QuotaResponse> {
  const until = Date.now() + 30_000;
  for (;;) {
    const q = await quota(value);
    if ((q.rate_limit?.request_current_usage ?? 0) >= count || Date.now() > until) return q;
    await sleep(500);
  }
}

async function palette(page: Page, text: string, row: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText(row);
  await page.keyboard.press('Enter');
}

async function command(page: Page, title: string | undefined): Promise<void> {
  await palette(page, `>${nls.category}: ${title}`, title ?? '');
}

/** Picks a colour theme the way a user does: Preferences: Color Theme, then the theme by its label in the picker. */
async function theme(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input');
  await input.fill('>Preferences: Color Theme');
  // "Browse Color Themes in Marketplace" matches the same words; pick the exact command.
  await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /Preferences: Color Theme(?!s)/ }).first().click();
  await expect(input).toHaveValue('');
  // The theme list loads after the picker opens; filtering before that hides every theme.
  const rows = page.locator('.quick-input-list .monaco-list-row');
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await input.fill(name);
  await rows.and(page.locator(`[aria-label^="${name}"]`)).first().click();
  await expect(input).toBeHidden();
}

async function setBaseUrl(page: Page, url: string): Promise<void> {
  await command(page, nls['command.setBaseUrl']);
  const input = page.locator('.quick-input-widget input');
  await input.fill(url);
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
}

async function setKey(page: Page, value: string): Promise<void> {
  await command(page, nls['command.setKey']);
  const input = page.locator('.quick-input-widget input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test.describe('Bifrost Meter in code-server', () => {
  let page: Page;
  const item = () => page.locator('[id$="bifrostMeter.status"]');

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${stack.editorUrl}/?folder=/home/coder`);
    await expect(page.locator('.statusbar')).toBeVisible({ timeout: 90_000 });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('asks for a key before one is set', async () => {
    await expect(item()).toContainText(t('state.unconfigured'), { timeout: 150_000 });
  });

  test('shows the numbers from the quota response after the key is set', async () => {
    await setKey(page, key('demo-team-a'));
    const want = expected(await quota(key('demo-team-a')));
    await expect(item()).toContainText(want.pct, { timeout: 30_000 });
    await expect(item()).toContainText(`${want.left} left`);
  });

  test('opens the details panel from the status bar', async () => {
    await item().click();
    await expect(page.locator('.tab', { hasText: t('tooltip.title') })).toBeVisible();
  });

  test('moves after mock traffic and a refresh', async () => {
    const value = key('demo-team-a');
    const before = await quota(value);
    const sent = 3;
    await traffic('demo-team-a', sent);
    const after = await requestsAtLeast(value, (before.rate_limit?.request_current_usage ?? 0) + sent);
    const want = expected(after);
    expect(want.left).not.toBe(expected(before).left);
    await command(page, nls['command.refresh']);
    await expect(item()).toContainText(`${want.left} left`, { timeout: 30_000 });
    await expect(item()).toContainText(want.pct);
  });

  test('captures the meter in the dark, light and high contrast themes', async () => {
    mkdirSync(images, { recursive: true });
    const themes = [
      ['light', 'Light 2026', 'vs'],
      ['high-contrast', 'Dark High Contrast', 'hc-black'],
      ['dark', 'Dark 2026', 'vs-dark'],
    ] as const;
    for (const [name, label, cls] of themes) {
      await theme(page, label);
      await expect(page.locator('.monaco-workbench')).toHaveClass(new RegExp(`(^|\\s)${cls}(\\s|$)`), { timeout: 20_000 });
      await item().hover();
      await expect(page.locator('.monaco-hover').first()).toBeVisible({ timeout: 10_000 });
      await sleep(300);
      await page.screenshot({ path: join(images, `e2e-${name}.png`) });
      await page.mouse.move(640, 400);
    }
  });

  test('warns once a limit passes the warning threshold', async () => {
    const value = key('demo-team-b');
    await setKey(page, value);
    const before = await quota(value);
    const limit = before.rate_limit?.request_max_limit ?? 0;
    expect(limit).toBeGreaterThan(0);
    const used = before.rate_limit?.request_current_usage ?? 0;
    const sent = Math.max(1, Math.ceil((limit * (defaults.warn + 2)) / 100) - used);
    await traffic('demo-team-b', sent);
    const after = await requestsAtLeast(value, used + sent);
    expect(expected(after).percent).toBeGreaterThanOrEqual(defaults.warn);
    await command(page, nls['command.refresh']);
    await expect(item()).toHaveClass(/warning-kind|has-background-color/, { timeout: 30_000 });
    await expect(page.locator('.notifications-toasts')).toContainText(' used, ', { timeout: 30_000 });
    await page.screenshot({ path: join(images, 'e2e-warning.png') });
  });

  test('shows "Key rejected" for an unknown key (401)', async () => {
    await setKey(page, ['sk', 'bf', 'e2e', 'unknown', '0000'].join('-'));
    await expect(item()).toContainText(t('state.unauthorized'), { timeout: 30_000 });
  });

  test('shows "Key expired" for an expired key (403)', async () => {
    const res = await fetch(`${stack.baseUrl}/api/governance/virtual-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bifrost-setup-token': stack.setupToken },
      body: JSON.stringify({
        name: `e2e-expiring-${Date.now()}`,
        expires_at: new Date(Date.now() + 2000).toISOString(),
        budgets: [{ max_limit: 1, reset_duration: '1d' }],
      }),
    });
    expect(res.status).toBe(200);
    const value = ((await res.json()) as { virtual_key?: { value?: string } }).virtual_key?.value ?? '';
    await sleep(3500);
    await setKey(page, value);
    await expect(item()).toContainText(t('state.expired'), { timeout: 30_000 });
  });

  test('shows "Gateway offline" when nothing answers at the gateway URL', async () => {
    await setKey(page, key('demo-team-a'));
    await setBaseUrl(page, 'http://localhost:9');
    await expect(item()).toContainText(t('state.offline'), { timeout: 45_000 });
    await setBaseUrl(page, 'http://localhost:8080');
    await expect(item()).toContainText(' left', { timeout: 45_000 });
  });
});
