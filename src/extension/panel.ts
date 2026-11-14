// The details panel: one webview tab, re-rendered whenever the meter renders. The HTML comes from panelHtml (pure).

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { fetchVersion } from '../core';
import { STORE_SERIES } from './controller';
import type { SeriesStore } from './forecasts';
import type { MeterState } from './state';
import { panelCommand, panelHtml } from './panelHtml';
import type { Ctx } from './view';

export interface PanelDeps {
  state: () => MeterState;
  key: () => string | undefined;
  store: vscode.Memento;
  ctx: () => Ctx;
  baseUrl: () => string;
}

export class DetailsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shown: string | undefined;
  private version: { baseUrl: string; value: string | undefined } | undefined;

  constructor(private readonly d: PanelDeps) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('bifrostMeter.details', this.d.ctx().t('tooltip.title'), vscode.ViewColumn.Active, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [],
    });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.shown = undefined;
    });
    panel.webview.onDidReceiveMessage((m: unknown) => {
      const command = panelCommand(m);
      if (command) void vscode.commands.executeCommand(command);
    });
    this.panel = panel;
    this.update();
  }

  /** Called after every meter render; a no-op while the panel is closed. */
  update(): void {
    const panel = this.panel;
    if (!panel) return;
    const c = this.d.ctx();
    const baseUrl = this.d.baseUrl();
    if (this.version?.baseUrl !== baseUrl) this.loadVersion(baseUrl, c.settings.allowInsecureHttp);
    panel.title = c.t('tooltip.title');
    const nonce = randomBytes(16).toString('base64');
    const html = panelHtml(
      {
        state: this.d.state(),
        key: this.d.key(),
        baseUrl,
        version: this.version?.value,
        series: this.d.store.get<SeriesStore>(STORE_SERIES) ?? {},
      },
      c,
      { nonce },
    );
    // Same content as on screen: keep the page (and the reader's scroll and focus) as it is.
    const content = html.split(nonce).join('');
    if (content === this.shown) return;
    this.shown = content;
    panel.webview.html = html;
  }

  private loadVersion(baseUrl: string, allowInsecureHttp: boolean): void {
    this.version = { baseUrl, value: undefined };
    void fetchVersion(baseUrl, allowInsecureHttp).then((value) => {
      if (this.version?.baseUrl !== baseUrl || !value) return;
      this.version.value = value;
      this.update();
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
