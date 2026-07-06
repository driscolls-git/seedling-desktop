import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import ar from './locales/ar.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'es', label: 'Espa\u00f1ol', dir: 'ltr' },
  { code: 'pt', label: 'Portugu\u00eas', dir: 'ltr' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', dir: 'rtl' },
] as const;

export type LanguageCode = typeof LANGUAGES[number]['code'];
