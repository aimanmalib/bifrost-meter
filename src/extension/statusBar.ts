// Renders the meter state into the status bar item. The only place that turns a StatusView into VS Code objects.

import * as vscode from 'vscode';
import type { MeterState } from './state';
import { COMMAND, tooltipMarkdown } from './tooltip';
import { statusView, type Ctx } from './view';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('bifrostMeter.status', vscode.StatusBarAlignment.Right, 100);
    this.item.command = COMMAND.openDetails;
    this.item.show();
  }

  render(state: MeterState, key: string | undefined, baseUrl: string, c: Ctx): void {
    const v = statusView(state, c);
    this.item.name = c.t('tooltip.title');
    this.item.text = `$(${v.icon}) ${v.text}`;
    this.item.accessibilityInformation = { label: v.accessibility, role: 'button' };
    this.item.backgroundColor = v.background ? new vscode.ThemeColor(`statusBarItem.${v.background}Background`) : undefined;
    const md = new vscode.MarkdownString(tooltipMarkdown({ state, key, baseUrl }, c), true);
    md.isTrusted = { enabledCommands: Object.values(COMMAND) };
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
