import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLES, pickLanguage, translator } from '../../src/core/i18n';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const placeholders = (s: string): string[] => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();

/** English and Malay files that must carry the same keys and the same placeholders. */
const PAIRS: [string, string][] = [
  ['l10n/bundle.l10n.json', 'l10n/bundle.l10n.ms.json'],
  ['package.nls.json', 'package.nls.ms.json'],
];

describe('language files', () => {
  for (const [enFile, msFile] of PAIRS) {
    const present = existsSync(root(enFile)) || existsSync(root(msFile));
    it.runIf(present)(`${enFile} and ${msFile} have the same keys and placeholders`, () => {
      const a = JSON.parse(readFileSync(root(enFile), 'utf8')) as Record<string, string>;
      const b = JSON.parse(readFileSync(root(msFile), 'utf8')) as Record<string, string>;
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      for (const k of Object.keys(a)) {
        expect(placeholders(b[k] ?? ''), k).toEqual(placeholders(a[k] ?? ''));
        expect((b[k] ?? '').trim(), `${msFile} ${k} is empty`).not.toBe('');
      }
    });
  }
});

describe('pickLanguage', () => {
  it.each([
    ['ms', 'en-US', 'ms'],
    ['en', 'ms', 'en'],
    ['auto', 'ms', 'ms'],
    ['auto', 'ms-MY', 'ms'],
    ['auto', 'ms_MY.UTF-8', 'ms'],
    ['auto', 'en-GB', 'en'],
    ['auto', 'id', 'en'],
    [undefined, undefined, 'en'],
    ['fr', 'fr', 'en'],
  ])('setting %s, locale %s → %s', (setting, locale, want) => expect(pickLanguage(setting, locale)).toBe(want));
});

describe('translator', () => {
  const bundles = { en: { a: 'Left {0} of {1}', only: 'English only' }, ms: { a: 'Baki {0} daripada {1}' } };
  it('fills placeholders', () => expect(translator('ms', bundles)('a', 3, '$5')).toBe('Baki 3 daripada $5'));
  it('falls back to English, then to the key', () => {
    expect(translator('ms', bundles)('only')).toBe('English only');
    expect(translator('ms', bundles)('missing.key')).toBe('missing.key');
  });
  it('leaves an unfilled placeholder visible', () => expect(translator('en', bundles)('a', 1)).toBe('Left 1 of {1}'));
  it('ships both real bundles', () => expect(Object.keys(BUNDLES.ms).length).toBe(Object.keys(BUNDLES.en).length));
});
