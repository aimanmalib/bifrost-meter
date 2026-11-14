// Stdio MCP server with one read-only tool, get_budget_status. Run with `node dist/mcp.js`; configuration comes from the
// environment (BIFROST_BASE_URL, BIFROST_VIRTUAL_KEY; see docs/MCP.md). The key is never written to stdout or stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { version } from '../../package.json';
import { readConfig } from './config';
import { createServer } from './tool';

async function main(): Promise<void> {
  const server = createServer({ config: readConfig(process.env), version });
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  // stdout belongs to the protocol; report startup failures on stderr without any environment values.
  process.stderr.write(`bifrost-meter mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
