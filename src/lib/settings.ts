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

interface Settings {
  startup: Startup;
  specific: ProjectRef | null;
}

const KEY = "qgisweb:settings";
const LAST = "qgisweb:last-project";

export function getSettings(): Settings {
  return { startup: "welcome", specific: null, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
}

export const saveSettings = (s: Settings) => localStorage.setItem(KEY, JSON.stringify(s));

export const lastProject = (): ProjectRef | null => JSON.parse(localStorage.getItem(LAST) ?? "null");

export const rememberLast = (ref: ProjectRef) => localStorage.setItem(LAST, JSON.stringify(ref));
