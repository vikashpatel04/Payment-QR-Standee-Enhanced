import i18next, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Every locale file. The app itself is in English; the others carry the customer
// display text the Content page shows as placeholders.
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../../../../locales/*.json', { eager: true });
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
  initAsync: false,
});

export { i18next };
