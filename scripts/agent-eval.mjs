#!/usr/bin/env node
// Agent evaluation: does a real coding agent check the budget tool and follow the AGENTS.md budget rule?
// Starts the pinned demo gateway, drives one virtual key per state with real requests, then runs Claude Code
// (`claude -p`, the signed-in account, no API key) on a neutral refactor prompt in a fresh temp project, with and
// without the bifrost-meter MCP server. Every run is written to demo/eval/runs/; totals to demo/eval/summary.json.
// Usage: node scripts/agent-eval.mjs [--config demo/eval/eval.config.json] [--report]
//   --report  only rebuild summary.json and the run table in docs/AGENT-EVAL.md from the saved runs.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { costPerRequest, driveState, seedKeys, settledQuota, startStack, stateKeys } from './agent-eval/gateway.mjs';
import { readTranscript, scoreRun, summarize } from './agent-eval/evaluate.mts';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const { values: args } = parseArgs({
  options: { config: { type: 'string', default: join(root, 'demo/eval/eval.config.json') }, report: { type: 'boolean', default: false } },
});
const cfg = JSON.parse(await readFile(args.config, 'utf8'));
const runsDir = join(root, 'demo/eval/runs');
const TOOL = 'mcp__bifrost-meter__get_budget_status';
const log = (m) => console.error(`agent-eval: ${m}`);

const redact = (v) => `…${String(v).slice(-4)}`;
const shortModel = (m) => m.replace(/^claude-/, '');

/** Removes key values, home and temp paths and session ids from anything written to the repository. */
function sanitize(value, secrets) {
  let text = JSON.stringify(value);
  for (const s of secrets) if (s) text = text.split(s).join(redact(s));
  text = text.replace(/"session_id":"[^"]*"/g, '"session_id":"<session>"');
  text = text.split(tmpdir()).join('<tmp>').split(homedir()).join('<home>');
  return JSON.parse(text);
}

/** get_budget_status as the agent would see it, read through the same MCP server: the ground truth for scoring. */
async function readingFor(stack, key) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'dist/mcp.js')],
    env: { PATH: process.env.PATH ?? '', BIFROST_BASE_URL: stack.baseUrl, BIFROST_VIRTUAL_KEY: key, BIFROST_METER_LANGUAGE: 'en' },
  });
  const client = new Client({ name: 'agent-eval', version: '1' });
  await client.connect(transport);
  try {
    const r = await client.callTool({ name: 'get_budget_status', arguments: {} });
    const text = r.content?.map((c) => c.text ?? '').join('\n') ?? '';
    return r.isError ? { ok: false, message: text } : { ok: true, limits: r.structuredContent.limits, text };
  } finally {
    await client.close();
  }
}

function agentsBlock(md) {
  const m = md.match(/```markdown\n([\s\S]*?)```/);
  if (!m) throw new Error(`${cfg.agentsFile} has no markdown block`);
  return m[1];
}

function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') delete env[k];
  return env;
}

const memoryExcludes = () => {
  const config = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return [join(homedir(), 'CLAUDE.md'), join(homedir(), 'AGENTS.md'), join(config, 'CLAUDE.md')];
};

function runClaude(argv, cwd) {
  return new Promise((done) => {
    const child = spawn('claude', argv, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), cfg.runTimeoutSeconds * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, out, err });
    });
  });
}

async function runAgent(job, agentsMd) {
  const dir = await mkdtemp(join(tmpdir(), 'bifrost-meter-eval-'));
  try {
    await cp(join(root, cfg.projectTemplate), dir, { recursive: true });
    await writeFile(join(dir, 'AGENTS.md'), agentsMd);
    await writeFile(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    const argv = ['-p', cfg.prompt, '--output-format', 'stream-json', '--verbose', '--model', job.model, '--tools', '',
      '--setting-sources', 'project,local', '--settings', JSON.stringify({ claudeMdExcludes: memoryExcludes() }),
      '--no-session-persistence', '--strict-mcp-config'];
    if (job.arm === 'with_tool') {
      const server = { command: process.execPath, args: [join(root, 'dist/mcp.js')],
        env: { BIFROST_BASE_URL: job.baseUrl, BIFROST_VIRTUAL_KEY: job.key, BIFROST_METER_LANGUAGE: 'en' } };
      await writeFile(join(dir, '.mcp-eval.json'), JSON.stringify({ mcpServers: { 'bifrost-meter': server } }), { mode: 0o600 });
      argv.push('--mcp-config', join(dir, '.mcp-eval.json'), '--allowedTools', TOOL);
    } else {
      argv.push('--mcp-config', JSON.stringify({ mcpServers: {} }));
    }
    const started = Date.now();
    const res = await runClaude(argv, dir);
    const events = res.out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
    const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
    const result = events.find((e) => e.type === 'result');
    await cleanMemoryDir(init.memory_paths?.auto, dir);
    const failed = !result || result.is_error || res.code !== 0;
    const transcript = readTranscript(events);
    return {
      id: job.id, model: init.model ?? job.model, model_requested: job.model, state: job.state.id, state_label: job.state.label,
      arm: job.arm, repeat: job.repeat, started_at: new Date(started).toISOString(), duration_ms: Date.now() - started,
      error: failed ? (result?.result ?? res.err.slice(-400)) || `exit ${res.code ?? res.signal}` : null,
      init: { apiKeySource: init.apiKeySource ?? null, claude_code_version: init.claude_code_version ?? null, tools: init.tools ?? [],
        mcp_servers: init.mcp_servers ?? [], memory_excludes: memoryExcludes(), setting_sources: 'project,local' },
      num_turns: result?.num_turns ?? null,
      tool_calls: transcript.toolCalls.map((c) => ({ name: c.name, is_error: c.isError, text: c.text })),
      answer: transcript.answer,
      reading: job.reading,
      score: failed ? null : scoreRun(transcript, job.reading, cfg.rule, TOOL),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Claude Code makes an auto-memory folder per working directory; remove the one for this temp project. */
async function cleanMemoryDir(autoPath, dir) {
  if (!autoPath || !autoPath.includes('bifrost-meter-eval-')) return;
  const project = dirname(autoPath.replace(/\/+$/, ''));
  if (project.includes(dir.split('/').at(-1))) await rm(project, { recursive: true, force: true });
}

async function pool(items, size, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function report() {
  const files = (await readdir(runsDir)).filter((f) => f.endsWith('.json')).sort();
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(runsDir, f), 'utf8'))));
  const byState = cfg.states.map((s) => {
    const rs = runs.filter((r) => r.state === s.id);
    return { state: s.id, label: s.label, expected: rs.find((r) => r.score)?.score.expected ?? null, ...summarize(rs) };
  });
  const summary = { ...summarize(runs), claude_code_version: runs.find((r) => r.init?.claude_code_version)?.init.claude_code_version ?? null,
    api_key_sources: [...new Set(runs.map((r) => r.init?.apiKeySource))], by_state: byState };
  await writeFile(join(root, 'demo/eval/summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const yes = (b) => (b === null || b === undefined ? 'n/a' : b ? 'yes' : 'no');
  const rows = runs.map((r) => `| ${r.id} | ${r.model} | ${r.state} | ${r.arm === 'with_tool' ? 'tool' : 'control'} | ${r.score ? yes(r.score.tool_before_answer) : '-'} | ${r.score?.decision ?? '-'} | ${r.score?.expected ?? '-'} | ${r.score ? yes(r.score.rule_followed) : '-'} | ${r.score ? yes(r.score.numbers_correct) : '-'} | ${r.error ? 'failed' : 'ok'} |`);
  const table = ['| Run | Model | State | Arm | Tool before answer | Decision | Rule expects | Rule followed | Numbers correct | Run |',
    '|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
  const docPath = join(root, 'docs/AGENT-EVAL.md');
  const doc = await readFile(docPath, 'utf8');
  const t = summary;
  const states = byState.map((b) => `| ${b.label} | ${b.expected ?? '-'} | ${b.rule_followed} of ${b.with_tool} | ${b.control_rule_followed} of ${b.control} |`);
  const totals = [
    `- Runs: ${t.runs} (${t.with_tool} with the tool, ${t.control} without it), models ${t.models.map((m) => `\`${m}\``).join(' and ')}; ${t.failed} failed to finish.`,
    `- Tool called before the answer: ${t.tool_before_answer} of ${t.with_tool}.`,
    `- Budget rule followed: ${t.rule_followed} of ${t.with_tool} with the tool; ${t.control_rule_followed} of ${t.control} without it.`,
    `- Quoted numbers matched the reading: ${t.numbers_correct} of ${t.numbers_checked} runs that quoted a percentage or a dollar amount.`,
    `- Claude Code ${t.claude_code_version}; \`apiKeySource\` in every run: ${t.api_key_sources.map((a) => `\`${a}\``).join(', ')}.`,
    '', '| State | Rule expects | With the tool: rule followed | Without it: rule followed |', '|---|---|---|---|', ...states,
  ].join('\n');
  // Function replacers: the inserted text is used as is ($ in it has no special meaning).
  const fill = (text, name, body) => text.replace(new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`), (_, a, b) => `${a}\n${body}\n${b}`);
  const marked = fill(fill(doc, 'summary', totals), 'runs', table);
  await writeFile(docPath, marked);
  log(`summary: ${JSON.stringify({ ...summary, by_state: undefined })}`);
}

async function evaluate() {
  const agentsMd = agentsBlock(await readFile(join(root, cfg.agentsFile), 'utf8'));
  const work = await mkdtemp(join(tmpdir(), 'bifrost-meter-eval-keys-'));
  const stack = await startStack(root, cfg.gateway);
  const secrets = [stack.env.BIFROST_SETUP_TOKEN];
  try {
    const perRequest = await costPerRequest(root, stack, cfg.gateway, work);
    log(`one mock request costs $${perRequest}`);
    const keys = await seedKeys(root, stack, cfg.gateway.provider, stateKeys(cfg.states, cfg.gateway, perRequest), work);
    const prepared = [];
    for (const state of cfg.states) {
      const key = state.kind === 'rejected' ? `sk-bf-${randomUUID()}` : keys.get(`eval-${state.id}`);
      secrets.push(key);
      const traffic = state.kind === 'rejected' ? { sent: 0, blocked: 0 } : await driveState(stack, key, state, cfg.gateway);
      if (state.kind !== 'rejected') await settledQuota(stack, key);
      const reading = await readingFor(stack, key);
      log(`${state.id}: ${traffic.sent} requests sent, ${traffic.blocked} blocked; ${reading.ok ? reading.text.split('\n')[0] : reading.message}`);
      prepared.push({ state, key, reading: { ...reading, traffic } });
    }
    const jobs = [];
    for (const p of prepared) {
      for (const model of cfg.models) {
        for (let i = 1; i <= cfg.repeatsWithTool; i++) jobs.push({ ...p, model, arm: 'with_tool', repeat: i });
        for (let i = 1; i <= cfg.repeatsControl; i++) jobs.push({ ...p, model, arm: 'control', repeat: i });
      }
    }
    await rm(runsDir, { recursive: true, force: true });
    await mkdir(runsDir, { recursive: true });
    let done = 0;
    await pool(jobs, cfg.concurrency, async (j) => {
      const job = { ...j, baseUrl: stack.baseUrl, id: `${j.state.id}-${shortModel(j.model)}-${j.arm === 'with_tool' ? 'tool' : 'control'}-${j.repeat}` };
      const record = sanitize(await runAgent(job, agentsMd), secrets);
      await writeFile(join(runsDir, `${job.id}.json`), JSON.stringify(record, null, 2) + '\n');
      done++;
      log(`${done}/${jobs.length} ${job.id}: ${record.error ? `failed (${String(record.error).slice(0, 80)})` : `${record.score.decision} (expects ${record.score.expected})`}`);
    });
  } finally {
    await stack.down();
    await rm(work, { recursive: true, force: true });
  }
  await report();
}

if (args.report) await report();
else await evaluate();
