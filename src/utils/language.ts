import { SWAHILI } from './swahili.ts';

export type Language = 'en' | 'sw';
export interface LocalizedLabel { en: string; sw: string }

/**
 * The Swahili interface stays off until a fluent speaker has read the text in
 * `swahili.ts`, which came from Google Translate. While it is off the language
 * switch is hidden and every label shows its English. Turning it on is this
 * one line.
 */
export const SWAHILI_INTERFACE = false;

export const LANGUAGE_STORAGE_KEY = 'll-language';

/** The language this browser chose last, read once so every page starts in it. */
function storedLanguage(): Language {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) === 'sw' ? 'sw' : 'en';
  } catch {
    return 'en';
  }
}

let current: Language = SWAHILI_INTERFACE ? storedLanguage() : 'en';

/** A label in both languages. English stands in where no Swahili is written. */
export const localized = (en: string): LocalizedLabel => ({ en, sw: SWAHILI[en] ?? en });

/** Sets the language labels render in; English while the Swahili interface is off. */
export function setInterfaceLanguage(language: Language): Language {
  current = SWAHILI_INTERFACE && language === 'sw' ? 'sw' : 'en';
  return current;
}

export const interfaceLanguage = (): Language => current;

/** The label in the interface language, or nothing for a missing label. */
export const text = (label: LocalizedLabel | undefined | null): string => (label ? label[current] : '');
