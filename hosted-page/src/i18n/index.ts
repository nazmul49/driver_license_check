import { createI18n } from 'vue-i18n';
import type { Locale } from '../lib/locale';
import en from './locales/en';
import nb from './locales/nb';

export type MessageSchema = typeof en;

/**
 * Composition API mode only. vue-i18n 11 compiles messages with its JIT (AST) compiler, which
 * does not use eval or new Function, so it runs under the strict CSP of the hosted page.
 */
export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, nb },
  missingWarn: false,
  fallbackWarn: false,
});

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  document.title = i18n.global.t('app.title');
}
