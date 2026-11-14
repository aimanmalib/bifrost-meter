// Shared by the unit and contract MCP tests: bundles the server into a temp folder and connects the official SDK client to
// it over stdio, with only the environment the server needs.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BuiltServer {
  script: string;
  cleanup(): void;
}

export async function buildServer(): Promise<BuiltServer> {
  const dir = mkdtempSync(join(tmpdir(), 'bifrost-meter-mcp-'));
  const script = join(dir, 'mcp.js');
  await build({ entryPoints: ['src/mcp/server.ts'], outfile: script, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'error' });
  return { script, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function connect(script: string, env: Record<string, string>): Promise<{ client: Client; stderr: () => string }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    // No inherited key or locale from the machine running the tests.
    env: { PATH: process.env.PATH ?? '', BIFROST_METER_LANGUAGE: 'en', ...env },
    stderr: 'pipe',
  });
  let err = '';
  transport.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const client = new Client({ name: 'bifrost-meter-test', version: '0.0.0' });
  await client.connect(transport);
  return { client, stderr: () => err };
}

export const textOf = (res: object): string => ((res as { content?: unknown }).content as { text?: string }[] | undefined)?.[0]?.text ?? '';
