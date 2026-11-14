// Stylesheet for the details panel. Only editor theme variables, so dark, light and high contrast themes work; the one theme rule
// drops the bar track fill in high contrast, where the slider and progress colours are close.

export const PANEL_STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 0 16px 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.45; }
main { max-width: 34rem; }
h1 { font-size: 1.25em; font-weight: 600; margin: 0; }
h2 { font-size: 1em; font-weight: 600; margin: 20px 0 6px; }
h3 { font-size: 1em; font-weight: 600; margin: 0; }
p { margin: 4px 0; }
header { padding: 14px 0 10px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)); }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.row > * { min-width: 0; }
.num, td.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--vscode-descriptionForeground); }
.keyline { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 6px; color: var(--vscode-descriptionForeground); }
.key-name { color: var(--vscode-foreground); font-weight: 600; overflow-wrap: anywhere; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.notice { margin: 14px 0 4px; padding: 10px 12px; border-left: 3px solid var(--vscode-focusBorder);
  background: var(--vscode-textBlockQuote-background); }
.notice.problem { border-left-color: var(--vscode-editorWarning-foreground); }
.notice button { margin-top: 8px; }
.limit { padding: 12px 0; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)); }
.level { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 8px; height: 8px; background: var(--meter); outline: 1px solid var(--vscode-contrastBorder, transparent); }
.lvl-ok { --meter: var(--vscode-progressBar-background); }
.lvl-warn { --meter: var(--vscode-editorWarning-foreground); }
.lvl-critical, .lvl-exhausted { --meter: var(--vscode-errorForeground); }
.bar { display: block; width: 100%; height: 14px; margin: 6px 0 4px; overflow: visible; }
.bar .track { fill: var(--vscode-scrollbarSlider-background); stroke: var(--vscode-contrastBorder, none); stroke-width: 1; }
.bar .fill { fill: var(--meter); }
/* High contrast themes give the slider and the fill near-identical colours: keep only the outline for the track. */
body.vscode-high-contrast .bar .track, body.vscode-high-contrast-light .bar .track { fill: transparent; }
.bar .notch { stroke: var(--vscode-foreground); stroke-width: 1.5; opacity: .7; }
.forecast { color: var(--vscode-editorWarning-foreground); }
.chart { display: block; width: 100%; height: 80px; margin-top: 4px; overflow: visible;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)); }
.chart .usage { fill: none; stroke: var(--vscode-progressBar-background); stroke-width: 2; }
.chart .limit { stroke: var(--vscode-descriptionForeground); stroke-width: 1; stroke-dasharray: 4 3; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 3px 0; text-align: left; font-weight: normal; overflow-wrap: anywhere; }
td.num { text-align: right; padding-left: 12px; white-space: nowrap; }
footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)); }
dl { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; }
dt { font-weight: 600; } dd { margin: 0; min-width: 0; }
.url { overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
button { font: inherit; padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer;
  color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
