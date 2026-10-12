import en from '@locales/en.json';
import i18next from 'i18next';

const instance = i18next.createInstance();
void instance.init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** Text for the tray, toasts and the History CSV. */
export const t = instance.t.bind(instance);
