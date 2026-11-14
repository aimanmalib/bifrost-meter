// Language choice and message lookup shared by the extension, MCP server and CLI. Messages live only in
// l10n/bundle.l10n.json (English) and l10n/bundle.l10n.ms.json (Malay); code holds keys, never text.

import en from '../../l10n/bundle.l10n.json';
import ms from '../../l10n/bundle.l10n.ms.json';

export type Language = 'en' | 'ms';
export type LanguageSetting = 'auto' | Language;
export type Bundle = Record<string, string>;

export const BUNDLES: Record<Language, Bundle> = { en, ms };

/**
 * Picks the display language. An explicit setting wins; `auto` follows the editor (or system) locale, so `ms`, `ms-MY` and
 * `ms_MY.UTF-8` give Malay and everything else gives English.
 */
export function pickLanguage(setting: string | undefined, locale: string | undefined): Language {
  if (setting === 'en' || setting === 'ms') return setting;
  const base = (locale ?? '').toLowerCase().split(/[-_.]/)[0];
  return base === 'ms' ? 'ms' : 'en';
}

/** Locale tag for Intl number and date formatting. */
export const intlLocale = (lang: Language): string => (lang === 'ms' ? 'ms-MY' : 'en-US');

export type Translate = (key: string, ...args: (string | number)[]) => string;

/** A translator for one language; missing keys fall back to English, then to the key itself so a gap is visible. */
export function translator(lang: Language, bundles: Record<Language, Bundle> = BUNDLES): Translate {
  const primary = bundles[lang];
  const fallback = bundles.en;
  return (key, ...args) => {
    const text = primary[key] ?? fallback[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (whole, i: string) => {
      const v = args[Number(i)];
      return v === undefined ? whole : String(v);
    });
  };
}
