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
export type CoordFormat = "project" | "decimal" | "dms" | "utm" | "mgrs";

interface Settings {
  startup: Startup;
  specific: ProjectRef | null;
  theme: Theme;
  coords: CoordFormat;
  /** Map view when a project opens: the view saved in the project (as QGIS does) or its full extent. */
  view: "saved" | "full";
  /** UI language code, or "auto" for the browser's. */
  language: string;
}

const KEY = "quarkgis:settings";
const LAST = "quarkgis:last-project";

export function getSettings(): Settings {
  return { startup: "welcome", specific: null, theme: "system", coords: "decimal", view: "saved", language: "auto", ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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

/** Settings as a file, to move them to another browser. */
export const exportSettings = () => new Blob([JSON.stringify(getSettings(), null, 2)], { type: "application/json" });

export function importSettings(text: string) {
  const s = JSON.parse(text);
  if (typeof s !== "object" || !s || !("startup" in s)) throw new Error("Not a QuarkGIS settings file");
  saveSettings(s);
}

export const lastProject = (): ProjectRef | null => JSON.parse(localStorage.getItem(LAST) ?? "null");

export const rememberLast = (ref: ProjectRef) => localStorage.setItem(LAST, JSON.stringify(ref));
