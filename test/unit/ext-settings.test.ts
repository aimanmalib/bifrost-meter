import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSettings } from '../../src/extension/settings';
import { resolveBaseUrl, resolveKey, validateKeyInput } from '../../src/extension/secrets';
import { COMMAND } from '../../src/extension/tooltip';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties as Record<string, { default: unknown; scope?: string }>;

describe('readSettings', () => {
  it('matches the package.json defaults when nothing is set', () => {
    const fromPkg = readSettings((k) => props[`bifrostMeter.${k}`]?.default);
    expect(readSettings(() => undefined)).toEqual(fromPkg);
    expect(fromPkg).toMatchObject({ baseUrl: 'http://localhost:8080', pollIntervalSeconds: 60, warn: 75, critical: 90 });
  });
  it('reads every setting package.json declares (and no other)', () => {
    const read = new Set<string>();
    readSettings((k) => {
      read.add(`bifrostMeter.${k}`);
      return undefined;
    });
    expect([...read].sort()).toEqual(Object.keys(props).sort());
  });
  it('clamps bad values', () => {
    const s = readSettings((k) => ({ pollIntervalSeconds: 1, 'thresholds.warn': 95, 'thresholds.critical': 80, 'statusBar.metric': 'x',
      baseUrl: '  ', 'forecast.windowMinutes': 0, language: 'fr' })[k]);
    expect(s).toMatchObject({ pollIntervalSeconds: 15, warn: 80, critical: 95, metric: 'auto', baseUrl: 'http://localhost:8080',
      forecastWindowMinutes: 5, language: 'auto' });
  });
  it('keeps the URL and insecure switch out of workspace settings', () => {
    expect(props['bifrostMeter.baseUrl']?.scope).toBe('application');
    expect(props['bifrostMeter.allowInsecureHttp']?.scope).toBe('application');
  });
});

describe('manifest', () => {
  it('declares exactly the seven commands the code registers', () => {
    const declared = (pkg.contributes.commands as { command: string }[]).map((c) => c.command).sort();
    expect(declared).toEqual(Object.values(COMMAND).sort());
  });
  it('every %placeholder% in package.json exists in both nls files', () => {
    const used = [...JSON.stringify(pkg).matchAll(/"%([^%"]+)%"/g)].map((m) => m[1] as string);
    for (const f of ['package.nls.json', 'package.nls.ms.json']) {
      const nls = JSON.parse(readFileSync(root(f), 'utf8')) as Record<string, string>;
      for (const k of used) expect(nls[k], `${f} ${k}`).toBeTruthy();
    }
  });
});

describe('key and URL sources', () => {
  it('prefers secret storage, then the environment', () => {
    expect(resolveKey('sk-bf-secret', { BIFROST_VIRTUAL_KEY: 'sk-bf-env' })).toEqual({ key: 'sk-bf-secret', source: 'secret' });
    expect(resolveKey(undefined, { BIFROST_VIRTUAL_KEY: ' sk-bf-env ' })).toEqual({ key: 'sk-bf-env', source: 'env' });
    expect(resolveKey('  ', {})).toEqual({ source: 'none' });
  });
  it('prefers an explicit URL setting, then the environment, then the default', () => {
    expect(resolveBaseUrl('https://a', { BIFROST_BASE_URL: 'https://b' }, 'http://localhost:8080')).toBe('https://a');
    expect(resolveBaseUrl(undefined, { BIFROST_BASE_URL: 'https://b' }, 'http://localhost:8080')).toBe('https://b');
    expect(resolveBaseUrl(undefined, {}, 'http://localhost:8080')).toBe('http://localhost:8080');
  });
  it.each([['', 'empty'], ['  ', 'empty'], ['sk bf', 'spaces'], ['sk-bf-x', undefined]])('validates %j', (v, want) =>
    expect(validateKeyInput(v)).toBe(want));
});
