// Notification sentences. Pure.

import { formatClock, formatDuration, formatPercent } from '../core';
import type { Note } from './notifications';
import { limitLabel, remainingText, type Ctx } from './view';

export function noteText(note: Note, c: Ctx): string {
  const label = limitLabel(note.limit, c.t);
  if (note.kind === 'forecast') {
    return c.t('note.forecast', label, formatClock(note.forecast.exhaustAt, c.lang), formatDuration(note.forecast.leadMs, c.t));
  }
  if (note.level === 'exhausted') return c.t('note.exhausted', label);
  return c.t(`note.${note.level}`, label, formatPercent(note.limit.percent, c.lang, c.t), remainingText(note.limit, c));
}
