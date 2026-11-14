// Inline SVG pieces for the details panel: the threshold bar and the usage chart. Pure; no text from the gateway goes in here
// except through the caller's escaping.

import type { Level, Limit, Sample } from '../core';

const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

/**
 * A horizontal bar 0–100 % with notches at the warn and critical thresholds. Over 100 % is drawn full. The caller adds the
 * percent as text next to it; the SVG itself carries the progressbar role and value.
 */
export function barSvg(percent: number, level: Level, warn: number, critical: number, label: string): string {
  const fill = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 100));
  const now = Math.round(fill);
  const notch = (x: number): string =>
    `<line class="notch" x1="${num(x)}" x2="${num(x)}" y1="0" y2="10" vector-effect="non-scaling-stroke"/>`;
  return (
    `<svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="progressbar" focusable="false" ` +
    `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${now}" aria-label="${label}">` +
    `<rect class="track" x="0" y="2" width="100" height="6" vector-effect="non-scaling-stroke"/>` +
    `<rect class="fill lvl-${level}" x="0" y="2" width="${num(fill)}" height="6"/>` +
    notch(warn) +
    notch(critical) +
    `</svg>`
  );
}

export interface ChartPoint {
  x: number;
  y: number;
}

/** Scales samples into a 0–300 × 0–80 box (y grows downwards). The top of the box is the larger of the limit and the peak. */
export function chartPoints(samples: Sample[], limit: number): { points: ChartPoint[]; limitY: number } {
  const W = 300;
  const H = 80;
  const t0 = samples[0]?.t ?? 0;
  const t1 = samples[samples.length - 1]?.t ?? t0;
  const span = Math.max(1, t1 - t0);
  const top = Math.max(limit, ...samples.map((s) => s.used), Number.EPSILON);
  const y = (v: number): number => H - (v / top) * H;
  return { points: samples.map((s) => ({ x: ((s.t - t0) / span) * W, y: y(s.used) })), limitY: y(limit) };
}

/** Usage line with the limit as a dashed line. Empty string when there are fewer than two samples to draw. */
export function chartSvg(samples: Sample[], l: Pick<Limit, 'limit'>, ariaLabel: string): string {
  if (samples.length < 2) return '';
  const { points, limitY } = chartPoints(samples, l.limit);
  const path = points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
  return (
    `<svg class="chart" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" focusable="false" aria-label="${ariaLabel}">` +
    `<line class="limit" x1="0" x2="300" y1="${num(limitY)}" y2="${num(limitY)}" vector-effect="non-scaling-stroke"/>` +
    `<polyline class="usage" points="${path}" vector-effect="non-scaling-stroke"/>` +
    `</svg>`
  );
}
