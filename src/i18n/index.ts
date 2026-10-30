import de from './de';
import en, { type Messages } from './en';

export type Lang = 'en' | 'de';

const catalogues: Record<Lang, Messages> = { en, de };

// Detected once per page load; the UI has no language switch of its own and
// follows the device setting.
export function detectLang(nav: { language?: string } | undefined = globalThis.navigator): Lang {
  return nav?.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const lang: Lang = detectLang();
export const t: Messages = catalogues[lang];
export { catalogues };
export type { Messages };
