// Where the key and gateway URL come from. SecretStorage wins; the documented environment variables are the fallback for
// editors without a UI to type a secret into. Pure apart from the small SecretStorage wrapper type.

export const SECRET_KEY = 'bifrostMeter.virtualKey';
export const ENV_KEY = 'BIFROST_VIRTUAL_KEY';
export const ENV_BASE_URL = 'BIFROST_BASE_URL';

export type KeySource = 'secret' | 'env' | 'none';

export function resolveKey(stored: string | undefined, env: Record<string, string | undefined>): { key?: string; source: KeySource } {
  const s = stored?.trim();
  if (s) return { key: s, source: 'secret' };
  const e = env[ENV_KEY]?.trim();
  if (e) return { key: e, source: 'env' };
  return { source: 'none' };
}

/** The URL setting wins when the user set it anywhere; otherwise the environment, otherwise the setting's default. */
export function resolveBaseUrl(explicit: string | undefined, env: Record<string, string | undefined>, fallback: string): string {
  const e = env[ENV_BASE_URL]?.trim();
  if (explicit?.trim()) return explicit.trim();
  return e || fallback;
}

/** Rejects obviously wrong input in the key prompt; the gateway is the real judge. */
export function validateKeyInput(value: string): 'empty' | 'spaces' | undefined {
  const v = value.trim();
  if (!v) return 'empty';
  if (/\s/.test(v)) return 'spaces';
  return undefined;
}
