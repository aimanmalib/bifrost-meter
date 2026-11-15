// Terminal entry point: `node dist/cli.js status` prints one line with the limit closest to running out, for an agent's
// status line, tmux or a shell prompt. `--format json` prints the same structured result as the MCP tool.
// Configuration comes from the environment, as for the MCP server (BIFROST_BASE_URL, BIFROST_VIRTUAL_KEY; docs/MCP.md).
// The key is never printed.

import { fetchQuota, translator } from '../core';
import { readConfig } from '../mcp/config';
import { budgetStatus } from '../mcp/status';
import { statusLine } from './line';

async function main(argv: string[]): Promise<number> {
  const config = readConfig(process.env);
  const t = translator(config.lang);
  const json = argv.includes('--format') && argv[argv.indexOf('--format') + 1] === 'json';
  if (argv[0] !== 'status' || argv.includes('--help')) {
    process.stdout.write(`${t('cli.usage')}\n`);
    return argv[0] === 'status' || argv.includes('--help') ? 0 : 2;
  }
  const result = await fetchQuota({ baseUrl: config.baseUrl, key: config.key, allowInsecureHttp: config.allowInsecureHttp });
  if (json) {
    const out = budgetStatus(result, config, Date.now(), {}, t);
    process.stdout.write(`${JSON.stringify(out.ok ? out.status : { error: out.error })}\n`);
    return out.ok ? 0 : 1;
  }
  const line = statusLine(result, Date.now(), t, config.lang);
  process.stdout.write(`${line.text}\n`);
  return line.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`bifrost-meter: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
