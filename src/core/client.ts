// HTTP client for the one endpoint the extension reads. Uses the built-in fetch; no other network access.
// The virtual key goes only to the configured gateway, never into results, errors or logs (see redactKey).

import { errorMessage, parseQuota, type QuotaResponse } from './schema';

export const QUOTA_PATH = '/api/governance/virtual-keys/quota';
export const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export type QuotaResult =
  | { kind: 'ok'; quota: QuotaResponse; status: number }
  | { kind: 'unauthorized'; status: 401; message?: string }
  | { kind: 'forbidden'; status: 403; expired: boolean; message?: string }
  | { kind: 'notFound'; status: 404 }
  | { kind: 'http'; status: number; message?: string }
  | { kind: 'schema'; field: string }
  | { kind: 'timeout' }
  | { kind: 'offline'; reason: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'insecure'; host: string }
  | { kind: 'invalidUrl' }
  | { kind: 'noKey' };

export interface QuotaRequest {
  baseUrl: string;
  key: string | undefined;
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Last four characters only, for display ("…a1b2"). Short or empty keys show nothing of the key. */
export function redactKey(key: string | undefined): string {
  if (!key) return '';
  return key.length > 8 ? `…${key.slice(-4)}` : '…';
}

/** Replaces any copy of the key inside a text (for messages that come back from a server). */
export function scrubKey(text: string, key: string | undefined): string {
  return key && key.length > 0 ? text.split(key).join(redactKey(key)) : text;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/**
 * True for hosts where plain http does not cross the public internet: loopback, RFC 1918, link-local, shared address space
 * (100.64/10, used by mesh VPNs), IPv6 unique-local and link-local, single-label names (Docker service names, intranet hosts)
 * and the reserved private suffixes.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || PRIVATE_SUFFIXES.some((s) => h.endsWith(s))) return true;
  const v4 = IPV4.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) {
    if (h === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped?.[1]) return isPrivateHost(mapped[1]);
    return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  return !h.includes('.');
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; result: QuotaResult };

/** Validates the gateway URL and builds the quota URL (a path prefix on the base URL is kept, for gateways behind a proxy). */
export function quotaUrl(baseUrl: string, allowInsecureHttp = false): UrlCheck {
  let base: URL;
  try {
    base = new URL(baseUrl.trim());
  } catch {
    return { ok: false, result: { kind: 'invalidUrl' } };
  }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username || base.password) {
    return { ok: false, result: { kind: 'invalidUrl' } };
  }
  if (base.protocol === 'http:' && !allowInsecureHttp && !isPrivateHost(base.hostname)) {
    return { ok: false, result: { kind: 'insecure', host: base.hostname } };
  }
  const path = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${path}${QUOTA_PATH}`, base.origin);
  return { ok: true, url };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

export async function fetchQuota(req: QuotaRequest): Promise<QuotaResult> {
  const key = req.key?.trim();
  if (!key) return { kind: 'noKey' };
  const checked = quotaUrl(req.baseUrl, req.allowInsecureHttp);
  if (!checked.ok) return checked.result;
  const doFetch = req.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = checked.url;
  let res: Response;
  try {
    for (let hop = 0; ; hop++) {
      res = await doFetch(url, { method: 'GET', headers: { 'x-bf-vk': key, accept: 'application/json' }, redirect: 'manual', signal });
      if (res.status < 300 || res.status >= 400) break;
      // Follow a redirect only inside the same origin, so the key never travels to another host.
      const location = res.headers.get('location');
      const next = location ? new URL(location, url) : undefined;
      if (!next || next.origin !== url.origin || hop >= MAX_REDIRECTS) return { kind: 'redirect', to: next ? next.origin : '' };
      url = next;
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
    return { kind: 'offline', reason: scrubKey(e instanceof Error ? e.message : String(e), key) };
  }
  const body = await readJson(res);
  const raw = errorMessage(body);
  const message = raw === undefined ? undefined : scrubKey(raw, key);
  const withMessage = message === undefined ? {} : { message };
  switch (res.status) {
    case 200: {
      const parsed = parseQuota(body);
      return parsed.ok ? { kind: 'ok', quota: parsed.value, status: 200 } : { kind: 'schema', field: parsed.field };
    }
    case 401:
      return { kind: 'unauthorized', status: 401, ...withMessage };
    case 403:
      return { kind: 'forbidden', status: 403, expired: /expired/i.test(message ?? ''), ...withMessage };
    case 404:
      return { kind: 'notFound', status: 404 };
    default:
      return { kind: 'http', status: res.status, ...withMessage };
  }
}
