import type { LocalText } from '@counterpay/core';
import { availableLanguages, i18next } from './i18n';

/** Before the agent sends its content: English only. */
export const DEFAULT_LANGS = ['en'];

/** English plus this device's own language, when we have text for it. Used before pairing. */
export function deviceLanguages(): string[] {
  const own = navigator.languages
    .map((tag) => tag.toLowerCase().split('-')[0] ?? '')
    .find((lang) => lang !== 'en' && availableLanguages.includes(lang));
  return own ? ['en', own] : ['en'];
}

export interface BiProps {
  langs: string[];
  /** A locale key, or text the shop wrote in several languages. */
  k?: string;
  text?: LocalText;
  vars?: Record<string, string>;
  className?: string;
  primary?: string;
  secondary?: string;
}

function pick(lang: string, k: string | undefined, text: LocalText | undefined, vars?: Record<string, string>): string {
  if (text) return text[lang] ?? '';
  return k ? i18next.getFixedT(lang)(k, vars) : '';
}

/** The same words in the display's languages, primary first and larger. */
export function Bi({ langs, k, text, vars, className, primary, secondary }: BiProps) {
  const [first = 'en', second] = langs;
  const one = pick(first, k, text, vars);
  const two = second ? pick(second, k, text, vars) : '';
  return (
    <div className={className}>
      {one && (
        <div className={primary} lang={first}>
          {one}
        </div>
      )}
      {two && two !== one && (
        <div className={secondary} lang={second}>
          {two}
        </div>
      )}
    </div>
  );
}

/** One line in one language, for labels that sit inline. */
export function say(lang: string, k: string, vars?: Record<string, string>): string {
  return i18next.getFixedT(lang)(k, vars);
}
