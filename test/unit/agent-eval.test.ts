import { describe, expect, it } from 'vitest';
import {
  expectedDecision,
  numbersCorrect,
  parseDecision,
  readTranscript,
  scoreRun,
  summarize,
  type LimitReading,
  type Reading,
  type RunRecord,
  type Rule,
} from '../../scripts/agent-eval/evaluate.mjs';

const TOOL = 'mcp__bifrost-meter__get_budget_status';
const rule: Rule = { askBelowRemainingPercent: 10, askWhenExhausted: true, askWhenForecastBeforeReset: true, askOnToolError: true };

function budget(usedPercent: number, extra: Partial<LimitReading> = {}): LimitReading {
  const limit = 0.0066;
  const used = (limit * usedPercent) / 100;
  return { kind: 'budget', unit: 'usd', limit, used, remaining: limit - used, percent: usedPercent, is_exhausted: usedPercent >= 100, will_exhaust_before_reset: null, ...extra };
}

const reading = (...limits: LimitReading[]): Reading => ({ ok: true, limits });

/** A stream-json transcript in the shape Claude Code writes: init, tool call, tool result, answer. */
function events(answer: string, withTool = true): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ type: 'system', subtype: 'init', model: 'claude-test', apiKeySource: 'none' }];
  if (withTool) {
    out.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: TOOL, input: {} }] } });
    out.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Budget: 7% left' }] }] } });
  }
  out.push({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
  out.push({ type: 'result', subtype: 'success', is_error: false, result: answer });
  return out;
}

describe('readTranscript', () => {
  it('pairs each tool call with its result and finds the final answer after it', () => {
    const t = readTranscript(events('Plan.\nDECISION: ask-first'));
    expect(t.toolCalls).toEqual([{ name: TOOL, index: 1, isError: false, text: 'Budget: 7% left' }]);
    expect(t.answer).toBe('Plan.\nDECISION: ask-first');
    expect(t.answerIndex).toBe(4);
  });

  it('marks a tool result flagged as an error', () => {
    const ev = events('x');
    (ev[2] as { message: { content: { is_error?: boolean }[] } }).message.content[0]!.is_error = true;
    expect(readTranscript(ev).toolCalls[0]?.isError).toBe(true);
  });

  it('has no answer when the run produced no result event', () => {
    expect(readTranscript(events('x').slice(0, 3)).answerIndex).toBe(-1);
  });
});

describe('parseDecision', () => {
  it('reads the last DECISION line, with or without backticks', () => {
    expect(parseDecision('DECISION: start')).toBe('start');
    expect(parseDecision('Options are `DECISION: start` or not.\n`DECISION: ask-first`')).toBe('ask-first');
    expect(parseDecision('decision: Ask-First')).toBe('ask-first');
  });

  it('is null when the agent gives no decision', () => {
    expect(parseDecision('I will begin now.')).toBeNull();
  });
});

describe('expectedDecision', () => {
  it('starts when every limit has at least the threshold left', () => {
    expect(expectedDecision(reading(budget(20)), rule)).toBe('start');
    expect(expectedDecision(reading(budget(81)), rule)).toBe('start');
    expect(expectedDecision(reading(budget(90)), rule)).toBe('start');
  });

  it('asks first below the threshold, when used up, or when the forecast runs out before the reset', () => {
    expect(expectedDecision(reading(budget(93)), rule)).toBe('ask-first');
    expect(expectedDecision(reading(budget(100)), rule)).toBe('ask-first');
    expect(expectedDecision(reading(budget(30, { will_exhaust_before_reset: true })), rule)).toBe('ask-first');
    const requests: LimitReading = { kind: 'requests', unit: 'requests', limit: 50, used: 46, remaining: 4, percent: 92, is_exhausted: false, will_exhaust_before_reset: null };
    expect(expectedDecision(reading(budget(20), requests), rule)).toBe('ask-first');
  });

  it('asks first when the tool returns an error, and follows the rule switches', () => {
    expect(expectedDecision({ ok: false, message: 'Key rejected' }, rule)).toBe('ask-first');
    expect(expectedDecision({ ok: false, message: 'Key rejected' }, { ...rule, askOnToolError: false })).toBe('start');
    expect(expectedDecision(reading(budget(30, { will_exhaust_before_reset: true })), { ...rule, askWhenForecastBeforeReset: false })).toBe('start');
  });
});

describe('numbersCorrect', () => {
  const r = reading(budget(93));

  it('accepts used and remaining percents within one point, the threshold, and dollar amounts within 2%', () => {
    expect(numbersCorrect('93% used, about 7% left (under the 10% line); $0.00046 of $0.0066 remains.', r, rule)).toBe(true);
    expect(numbersCorrect('Roughly 6.5% left.', r, rule)).toBe(true);
  });

  it('rejects a percent or amount that is not in the reading', () => {
    expect(numbersCorrect('Only 3% left.', r, rule)).toBe(false);
    expect(numbersCorrect('$0.5 left.', r, rule)).toBe(false);
  });

  it('is null when no number is quoted or there was no reading', () => {
    expect(numbersCorrect('The budget is low.', r, rule)).toBeNull();
    expect(numbersCorrect('7% left', { ok: false, message: 'x' }, rule)).toBeNull();
  });
});

describe('scoreRun', () => {
  it('scores a run that called the tool, asked first and quoted the reading', () => {
    const s = scoreRun(readTranscript(events('About 7% of the budget is left.\nDECISION: ask-first')), reading(budget(93)), rule, TOOL);
    expect(s).toEqual({ tool_called: true, tool_before_answer: true, decision: 'ask-first', expected: 'ask-first', rule_followed: true, numbers_correct: true });
  });

  it('scores a control run that started without checking', () => {
    const s = scoreRun(readTranscript(events('Starting.\nDECISION: start', false)), reading(budget(93)), rule, TOOL);
    expect(s).toMatchObject({ tool_called: false, tool_before_answer: false, decision: 'start', rule_followed: false, numbers_correct: null });
  });

  it('does not count a different tool as the budget tool', () => {
    const ev = events('DECISION: start');
    (ev[1] as { message: { content: { name: string }[] } }).message.content[0]!.name = 'mcp__other__tool';
    expect(scoreRun(readTranscript(ev), reading(budget(20)), rule, TOOL).tool_called).toBe(false);
  });
});

describe('summarize', () => {
  it('counts tool and control runs apart and keeps failed runs only in the totals', () => {
    const ok = scoreRun(readTranscript(events('7% left\nDECISION: ask-first')), reading(budget(93)), rule, TOOL);
    const control = scoreRun(readTranscript(events('DECISION: start', false)), reading(budget(93)), rule, TOOL);
    const runs: RunRecord[] = [
      { model: 'b', state: 's', arm: 'with_tool', error: null, score: ok },
      { model: 'a', state: 's', arm: 'with_tool', error: 'timeout', score: null },
      { model: 'a', state: 's', arm: 'control', error: null, score: control },
    ];
    expect(summarize(runs)).toEqual({
      runs: 3, completed: 2, failed: 1, models: ['a', 'b'], with_tool: 2, control: 1, tool_before_answer: 1, rule_followed: 1,
      numbers_checked: 1, numbers_correct: 1, control_rule_followed: 0, control_tool_called: 0,
    });
  });
});
