// Entry point: wires settings, secrets, the meter, the poller, the status bar, notifications and the commands.

import * as vscode from 'vscode';
import { pickLanguage, translator } from '../core';
import { registerCommands } from './commands';
import { Meter } from './controller';
import { noteText } from './noteText';
import { Poller } from './poller';
import { resolveBaseUrl, resolveKey, SECRET_KEY } from './secrets';
import { readSettings } from './settings';
import { StatusBar } from './statusBar';
import type { Ctx } from './view';

const SECTION = 'bifrostMeter';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Bifrost Meter', { log: true });
  const bar = new StatusBar();
  const settings = () => readSettings((k) => vscode.workspace.getConfiguration(SECTION).get(k));
  const baseUrl = () => {
    const i = vscode.workspace.getConfiguration(SECTION).inspect<string>('baseUrl');
    // Application scope only: a workspace cannot point the key at another host (see ADR 0004).
    const explicit = i?.globalValue;
    return resolveBaseUrl(explicit, process.env, settings().baseUrl);
  };
  const ctx = (): Ctx => {
    const s = settings();
    const lang = pickLanguage(s.language, vscode.env.language);
    return { t: translator(lang), lang, now: Date.now(), settings: s };
  };

  const meter = new Meter({
    settings,
    baseUrl,
    key: async () => resolveKey(await context.secrets.get(SECRET_KEY), process.env).key,
    store: context.globalState,
    now: Date.now,
    render: (state, key) => bar.render(state, key, baseUrl(), ctx()),
    notify: (note) => {
      const c = ctx();
      const open = c.t('action.openDetails');
      const show = note.kind === 'threshold' && note.level !== 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      void show(noteText(note, c), open).then((pick) => {
        if (pick === open) void vscode.commands.executeCommand('bifrostMeter.openDetails');
      });
    },
    log: (line) => log.info(line),
  });

  const poller = new Poller(() => meter.refresh(), () => settings().pollIntervalSeconds);
  meter.showLoading();
  poller.start();

  context.subscriptions.push(
    log,
    bar,
    { dispose: () => poller.stop() },
    ...registerCommands({ context, meter, poller, log, ctx, baseUrl }),
    vscode.window.onDidChangeWindowState((w) => poller.setFocused(w.focused)),
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) void meter.reset().then(() => poller.refreshNow());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      if (e.affectsConfiguration(`${SECTION}.baseUrl`) || e.affectsConfiguration(`${SECTION}.allowInsecureHttp`)) {
        void meter.reset().then(() => poller.refreshNow());
      } else {
        meter.rerender();
      }
    }),
  );
}

export function deactivate(): void {
  // Disposables registered in activate stop the poller and remove the status bar item.
}
