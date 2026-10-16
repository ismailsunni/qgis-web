import { getSettings } from "./settings";

/**
 * UI translations: English text is the key, so untranslated strings stay in English.
 * Dictionaries live in src/i18n/<code>.json; placeholders are written {name}.
 */
export const LANGUAGES: Record<string, string> = { en: "English", de: "Deutsch", es: "Español", fr: "Français", id: "Bahasa Indonesia" };

const loaders = import.meta.glob<Record<string, string>>("../i18n/*.json", { import: "default" });
let dict: Record<string, string> = {};

/** The language chosen in Settings, or the browser's. */
export function currentLanguage() {
  const chosen = getSettings().language;
  const code = chosen && chosen !== "auto" ? chosen : navigator.language.slice(0, 2);
  return code in LANGUAGES ? code : "en";
}

export async function loadLanguage() {
  const code = currentLanguage();
  document.documentElement.lang = code;
  dict = (await loaders[`../i18n/${code}.json`]?.()) ?? {};
}

/** Marks English text in constant tables for translation; translate it with t() where it's shown. */
export const N_ = (text: string) => text;

export function t(text: string, vars?: Record<string, string | number>) {
  let s = dict[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
