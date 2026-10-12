import en from '@locales/en.json';
import ta from '@locales/ta.json';
import i18next from 'i18next';

const instance = i18next.createInstance();
void instance.init({
  resources: { en: { translation: en }, ta: { translation: ta } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function setAppLanguage(lang: string): void {
  if (instance.language !== lang) void instance.changeLanguage(lang);
}

/** Text for the tray, toasts and the History CSV, in the app language. */
export const t = instance.t.bind(instance);
