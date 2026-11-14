import { describe, expect, it } from 'vitest';
import type { Forecast } from '../../src/core';
import { decideNotes, type NoteStore } from '../../src/extension/notifications';
import { HOUR, limit, NOW } from './ext-helpers';

const S = { warn: 75, critical: 90, notifications: true };
const run = (used: number, store: NoteStore = {}, over = {}, forecasts: Record<string, Forecast> = {}) =>
  decideNotes([limit({ used, ...over })], forecasts, { ...S }, store);

describe('threshold notifications', () => {
  it('fires once per threshold per cycle', () => {
    const a = run(8);
    expect(a.notes.map((n) => n.kind === 'threshold' && n.level)).toEqual(['warn']);
    const b = run(8.5, a.store);
    expect(b.notes).toEqual([]);
    const c = run(9.2, b.store);
    expect(c.notes.map((n) => n.kind === 'threshold' && n.level)).toEqual(['critical']);
    expect(run(9.3, c.store).notes).toEqual([]);
  });
  it('a jump straight to used up shows one notification', () => {
    expect(run(10).notes.map((n) => n.kind === 'threshold' && n.level)).toEqual(['exhausted']);
  });
  it('a new reset cycle starts over', () => {
    const a = run(8);
    const b = run(8, a.store, { lastReset: NOW });
    expect(b.notes).toHaveLength(1);
  });
  it('stays quiet below the warning threshold', () => {
    expect(run(5).notes).toEqual([]);
  });
  it('when switched off, records state but shows nothing, and does not replay later', () => {
    const off = decideNotes([limit({ used: 8 })], {}, { ...S, notifications: false }, {});
    expect(off.notes).toEqual([]);
    expect(run(8, off.store).notes).toEqual([]);
  });
});

describe('forecast notification', () => {
  const rising = (beforeReset: boolean): Record<string, Forecast> => ({
    'budget:a': { status: 'rising', ratePerHour: 1, exhaustAt: NOW + HOUR, beforeReset, leadMs: beforeReset ? 3 * HOUR : 0 },
  });
  it('fires once per cycle when the limit runs out before the reset', () => {
    const a = run(5, {}, {}, rising(true));
    expect(a.notes.map((n) => n.kind)).toEqual(['forecast']);
    expect(run(5.5, a.store, {}, rising(true)).notes).toEqual([]);
  });
  it('does not fire when the reset comes first', () => {
    expect(run(5, {}, {}, rising(false)).notes).toEqual([]);
  });
});
