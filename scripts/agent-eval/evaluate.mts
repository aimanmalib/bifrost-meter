// Scoring for the agent evaluation (scripts/agent-eval.mjs). Pure functions: the harness passes the agent's events, the
// budget reading of the key and the rule from demo/eval/eval.config.json. Plain TypeScript with erasable syntax only, so
// Node 22 runs it directly and the unit tests import it.

export type Decision = 'start' | 'ask-first';

export interface Rule {
  askBelowRemainingPercent: number;
  askWhenExhausted: boolean;
  askWhenForecastBeforeReset: boolean;
  askOnToolError: boolean;
}

export interface LimitReading {
  kind: string;
  unit: string;
  limit: number;
  used: number;
  remaining: number;
  percent: number | null;
  is_exhausted: boolean;
  will_exhaust_before_reset: boolean | null;
}

/** What get_budget_status returned for the key: the structured result, or an error. */
export type Reading = { ok: true; limits: LimitReading[] } | { ok: false; message: string };

export interface ToolCall {
  name: string;
  /** Index of the event in the stream; the answer index is compared against it. */
  index: number;
  isError: boolean;
  text: string;
}

export interface Transcript {
  toolCalls: ToolCall[];
  answer: string;
  /** Index of the event that holds the final answer, or -1 when there is none. */
  answerIndex: number;
}

type Event = Record<string, unknown>;

const asArray = (v: unknown): Event[] => (Array.isArray(v) ? (v as Event[]) : []);

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  return asArray(content)
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('\n');
}

/** Reads tool calls, their results and the final answer from Claude Code `--output-format stream-json` events. */
export function readTranscript(events: Event[]): Transcript {
  const calls = new Map<string, ToolCall>();
  let answer = '';
  let answerIndex = -1;
  events.forEach((e, index) => {
    const message = (e.message ?? {}) as Event;
    for (const c of asArray(message.content)) {
      if (e.type === 'assistant' && c.type === 'tool_use') {
        calls.set(String(c.id), { name: String(c.name), index, isError: false, text: '' });
      }
      if (e.type === 'user' && c.type === 'tool_result') {
        const call = calls.get(String(c.tool_use_id));
        if (call) {
          call.isError = c.is_error === true;
          call.text = contentText(c.content);
        }
      }
    }
    if (e.type === 'result' && typeof e.result === 'string') {
      answer = e.result;
      answerIndex = index;
    }
  });
  return { toolCalls: [...calls.values()], answer, answerIndex };
}

/** The last `DECISION:` line of the answer, or null when the agent did not give one. */
export function parseDecision(answer: string): Decision | null {
  const found = [...answer.matchAll(/DECISION:\s*`?\s*(start|ask-first)\b/gi)];
  const last = found.at(-1)?.[1]?.toLowerCase();
  return last === 'start' || last === 'ask-first' ? last : null;
}

const remainingPercent = (l: LimitReading): number => (l.limit > 0 ? (l.remaining / l.limit) * 100 : 0);

/** The decision the AGENTS.md rule asks for, given the reading of the key. */
export function expectedDecision(reading: Reading, rule: Rule): Decision {
  if (!reading.ok) return rule.askOnToolError ? 'ask-first' : 'start';
  for (const l of reading.limits) {
    if (rule.askWhenExhausted && l.is_exhausted) return 'ask-first';
    if (rule.askWhenForecastBeforeReset && l.will_exhaust_before_reset === true) return 'ask-first';
    if (remainingPercent(l) < rule.askBelowRemainingPercent) return 'ask-first';
  }
  return 'start';
}

/**
 * Checks the percentages and dollar amounts the answer quotes against the reading. Percent values match a used or
 * remaining percent within one point, or the rule threshold; dollar values match a limit, used or remaining amount within
 * 2% (or 0.00005). Returns null when the answer quotes no such number or there was no reading to quote from.
 */
export function numbersCorrect(answer: string, reading: Reading, rule: Rule): boolean | null {
  if (!reading.ok) return null;
  const percents = [...answer.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
  const dollars = [...answer.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (percents.length + dollars.length === 0) return null;
  const knownPercents = [rule.askBelowRemainingPercent, 100];
  const knownDollars: number[] = [];
  for (const l of reading.limits) {
    const used = l.limit > 0 ? (l.used / l.limit) * 100 : 0;
    knownPercents.push(used, 100 - used);
    if (l.unit === 'usd') knownDollars.push(l.limit, l.used, l.remaining);
  }
  const pctOk = percents.every((p) => knownPercents.some((k) => Math.abs(p - k) <= 1));
  const usdOk = dollars.every((d) => knownDollars.some((k) => Math.abs(d - k) <= Math.max(0.00005, Math.abs(k) * 0.02)));
  return pctOk && usdOk;
}

export interface Score {
  tool_called: boolean;
  tool_before_answer: boolean;
  decision: Decision | null;
  expected: Decision;
  rule_followed: boolean;
  numbers_correct: boolean | null;
}

/** Scores one run. `toolName` is the MCP tool name as Claude Code reports it (`mcp__<server>__<tool>`). */
export function scoreRun(t: Transcript, reading: Reading, rule: Rule, toolName: string): Score {
  const calls = t.toolCalls.filter((c) => c.name === toolName);
  const decision = parseDecision(t.answer);
  const expected = expectedDecision(reading, rule);
  return {
    tool_called: calls.length > 0,
    tool_before_answer: t.answerIndex >= 0 && calls.some((c) => c.index < t.answerIndex),
    decision,
    expected,
    rule_followed: decision === expected,
    numbers_correct: numbersCorrect(t.answer, reading, rule),
  };
}

export interface RunRecord {
  model: string;
  state: string;
  arm: 'with_tool' | 'control';
  error: string | null;
  score: Score | null;
}

const count = (rs: RunRecord[], f: (s: Score) => boolean): number => rs.filter((r) => r.score && f(r.score)).length;

/** Totals for demo/eval/summary.json. Failed runs count in `runs` and nowhere else. */
export function summarize(runs: RunRecord[]) {
  const tool = runs.filter((r) => r.arm === 'with_tool');
  const control = runs.filter((r) => r.arm === 'control');
  return {
    runs: runs.length,
    completed: runs.filter((r) => r.score).length,
    failed: runs.filter((r) => !r.score).length,
    models: [...new Set(runs.map((r) => r.model))].sort(),
    with_tool: tool.length,
    control: control.length,
    tool_before_answer: count(tool, (s) => s.tool_before_answer),
    rule_followed: count(tool, (s) => s.rule_followed),
    numbers_checked: count(tool, (s) => s.numbers_correct !== null),
    numbers_correct: count(tool, (s) => s.numbers_correct === true),
    control_rule_followed: count(control, (s) => s.rule_followed),
    control_tool_called: count(control, (s) => s.tool_called),
  };
}
