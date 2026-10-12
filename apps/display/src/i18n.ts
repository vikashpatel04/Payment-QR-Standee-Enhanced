import i18next, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Every locale file: a display can show any two of the display languages.
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../../locales/*.json', { eager: true });
const resources: Resource = {};
for (const [path, file] of Object.entries(files)) {
  const lang = /([a-z]{2,3})\.json$/.exec(path)?.[1];
  if (lang) resources[lang] = { translation: file.default };
}

void i18next.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Display languages this page has text for. */
export const availableLanguages = Object.keys(resources);

export { i18next };
