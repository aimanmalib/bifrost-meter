// The seven commands. Thin: prompts and clipboard here, logic in the pure modules.

import * as vscode from 'vscode';
import { quotaUrl, redactKey } from '../core';
import type { Meter } from './controller';
import type { Poller } from './poller';
import { SECRET_KEY, validateKeyInput } from './secrets';
import { COMMAND, summaryText } from './tooltip';
import type { Ctx } from './view';

export interface CommandDeps {
  context: vscode.ExtensionContext;
  meter: Meter;
  poller: Poller;
  log: vscode.LogOutputChannel;
  ctx: () => Ctx;
  baseUrl: () => string;
  details: { show(): void };
}

export function registerCommands(d: CommandDeps): vscode.Disposable[] {
  const reg = (id: string, fn: () => unknown) => vscode.commands.registerCommand(id, fn);
  return [
    reg(COMMAND.setKey, async () => {
      const { t } = d.ctx();
      const value = await vscode.window.showInputBox({
        title: t('prompt.key.title'),
        prompt: t('prompt.key.prompt'),
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => {
          const problem = validateKeyInput(v);
          return problem ? t(`prompt.key.${problem}`) : undefined;
        },
      });
      if (value === undefined) return;
      await d.context.secrets.store(SECRET_KEY, value.trim());
      d.log.info(`key set (${redactKey(value.trim())})`);
    }),
    reg(COMMAND.clearKey, async () => {
      await d.context.secrets.delete(SECRET_KEY);
      d.log.info('key cleared');
      void vscode.window.showInformationMessage(d.ctx().t('info.keyCleared'));
    }),
    reg(COMMAND.setBaseUrl, async () => {
      const { t, settings } = d.ctx();
      const value = await vscode.window.showInputBox({
        title: t('prompt.url.title'),
        prompt: t('prompt.url.prompt'),
        value: d.baseUrl(),
        ignoreFocusOut: true,
        validateInput: (v) => {
          const check = quotaUrl(v.trim(), settings.allowInsecureHttp);
          if (check.ok) return undefined;
          return check.result.kind === 'insecure' ? t('prompt.url.insecure') : t('prompt.url.invalid');
        },
      });
      if (value === undefined) return;
      await vscode.workspace.getConfiguration('bifrostMeter').update('baseUrl', value.trim(), vscode.ConfigurationTarget.Global);
    }),
    reg(COMMAND.refresh, async () => {
      d.meter.showLoading();
      await d.poller.refreshNow();
    }),
    reg(COMMAND.openDetails, () => d.details.show()),
    reg(COMMAND.copySummary, async () => {
      const c = d.ctx();
      await vscode.env.clipboard.writeText(summaryText({ state: d.meter.state, key: d.meter.key, baseUrl: d.baseUrl() }, c));
      void vscode.window.showInformationMessage(c.t('info.copied'));
    }),
    reg(COMMAND.showLog, () => d.log.show()),
  ];
}
