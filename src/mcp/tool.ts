// The get_budget_status tool on an MCP server object. Separate from the stdio entry point so tests can connect any transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchQuota, translator } from '../core';
import type { SeriesStore } from '../extension/forecasts';
import type { McpConfig } from './config';
import { budgetStatus } from './status';

export const TOOL_NAME = 'get_budget_status';

export interface ToolDeps {
  config: McpConfig;
  version: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

const limitShape = z.object({
  kind: z.enum(['budget', 'tokens', 'requests']),
  scope: z.enum(['key', 'provider', 'model']),
  scope_label: z.string().nullable(),
  unit: z.enum(['usd', 'tokens', 'requests']),
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  percent: z.number().nullable(),
  is_exhausted: z.boolean(),
  reset_period: z.string().nullable(),
  resets_at: z.string().nullable(),
  forecast: z.enum(['insufficient_data', 'steady', 'rising', 'exhausted']),
  exhausts_at: z.string().nullable(),
  will_exhaust_before_reset: z.boolean().nullable(),
});

export const outputShape = {
  read_at: z.string(),
  gateway: z.string(),
  key_name: z.string(),
  key_hint: z.string(),
  is_active: z.boolean(),
  is_exhausted: z.boolean(),
  will_exhaust_before_reset: z.boolean().nullable(),
  limits: z.array(limitShape),
};

export function createServer(deps: ToolDeps): McpServer {
  const t = translator(deps.config.lang);
  const now = deps.now ?? Date.now;
  // Readings from earlier calls in this process feed the run-out forecast; nothing is written to disk.
  let store: SeriesStore = {};
  const server = new McpServer({ name: 'bifrost-meter', version: deps.version });
  server.registerTool(
    TOOL_NAME,
    {
      title: t('mcp.tool.title'),
      description: t('mcp.tool.description'),
      outputSchema: outputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = await fetchQuota({
        baseUrl: deps.config.baseUrl,
        key: deps.config.key,
        allowInsecureHttp: deps.config.allowInsecureHttp,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      const out = budgetStatus(result, deps.config, now(), store, t);
      store = out.store;
      if (!out.ok) return { isError: true, content: [{ type: 'text' as const, text: out.text }] };
      return { content: [{ type: 'text' as const, text: out.text }], structuredContent: { ...out.status } };
    },
  );
  return server;
}
