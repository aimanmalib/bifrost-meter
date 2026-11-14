// Editor actions shared by the e2e suite and the demo recording: the command palette and the masked key input,
// driven the way a user drives them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { root } from './stack';

export const nls = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;

export async function palette(page: Page, text: string, row: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText(row);
  await page.keyboard.press('Enter');
}

export async function command(page: Page, title: string | undefined): Promise<void> {
  await palette(page, `>${nls.category}: ${title}`, title ?? '');
}

export async function setKey(page: Page, value: string): Promise<void> {
  await command(page, nls['command.setKey']);
  const input = page.locator('.quick-input-widget input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
}
