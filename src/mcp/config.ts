// Configuration of the MCP server, read from the process environment only. The extension sets these when it registers the
// server with VS Code; other MCP clients set them in their own server entry (docs/MCP.md).

import { pickLanguage, type Language } from '../core';
import { readSettings } from '../extension/settings';
import { ENV_BASE_URL, ENV_KEY } from '../extension/secrets';

export const ENV_ALLOW_INSECURE = 'BIFROST_ALLOW_INSECURE_HTTP';
export const ENV_LANGUAGE = 'BIFROST_METER_LANGUAGE';
export const ENV_FORECAST_WINDOW = 'BIFROST_METER_FORECAST_WINDOW_MINUTES';

export interface McpConfig {
  baseUrl: string;
  key: string | undefined;
  allowInsecureHttp: boolean;
  lang: Language;
  forecastWindowMinutes: number;
}

type Env = Record<string, string | undefined>;

const truthy = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test(v?.trim() ?? '');

/** Same defaults and clamping as the extension settings, so both read a key the same way. */
export function readConfig(env: Env): McpConfig {
  const values: Record<string, unknown> = {
    baseUrl: env[ENV_BASE_URL],
    allowInsecureHttp: truthy(env[ENV_ALLOW_INSECURE]),
    language: env[ENV_LANGUAGE]?.trim(),
    'forecast.windowMinutes': env[ENV_FORECAST_WINDOW] ? Number(env[ENV_FORECAST_WINDOW]) : undefined,
  };
  const s = readSettings((k) => values[k]);
  return {
    baseUrl: s.baseUrl,
    key: env[ENV_KEY]?.trim() || undefined,
    allowInsecureHttp: s.allowInsecureHttp,
    lang: pickLanguage(s.language, env.LC_ALL || env.LC_MESSAGES || env.LANG),
    forecastWindowMinutes: s.forecastWindowMinutes,
  };
}
