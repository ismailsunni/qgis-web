/** App settings kept in this browser, like QGIS's Options › General. */

/** What opens on launch (QGIS: "Open project on launch"). */
export type Startup = "welcome" | "blank" | "last" | "specific";

/** A project that can be reopened without asking for files. */
export type ProjectRef =
  | { kind: "stored"; id: string; name: string }
  | { kind: "url"; url: string; name: string }
  | { kind: "gist"; ref: string; name: string }
  /** Opened from local files and not saved in the browser: can't be reopened. */
  | { kind: "local"; name: string };

export type Theme = "system" | "light" | "dark";
export type CoordFormat = "project" | "decimal" | "dms" | "utm";

interface Settings {
  startup: Startup;
  specific: ProjectRef | null;
  theme: Theme;
  coords: CoordFormat;
}

const KEY = "qgisweb:settings";
const LAST = "qgisweb:last-project";

export function getSettings(): Settings {
  return { startup: "welcome", specific: null, theme: "system", coords: "decimal", ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
}

export function saveSettings(s: Partial<Settings>) {
  localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), ...s }));
  applyTheme();
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

/** Sets the color theme on the document (following the system unless chosen). */
export function applyTheme() {
  const { theme } = getSettings();
  const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
darkQuery.addEventListener("change", applyTheme);

export const lastProject = (): ProjectRef | null => JSON.parse(localStorage.getItem(LAST) ?? "null");

export const rememberLast = (ref: ProjectRef) => localStorage.setItem(LAST, JSON.stringify(ref));
