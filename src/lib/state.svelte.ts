import type { QgsFeature } from "qgis-js";

const params = new URLSearchParams(location.search);

export const view = {
  url: params.get("url"),
  /** A published map: "owner/gistId", optionally at a version. */
  gist: params.get("gist"),
  rev: params.get("rev"),
  mapOnly: params.has("maponly"),
  compact: params.get("layout") === "compact",
  noPanels: params.get("panels") === "none",
};

export type Panel = "layers" | "add" | "style" | "tools" | "hub" | "bookmarks";

export interface IdentifyHit {
  layerId: string;
  layerName: string;
  fid: number;
  title: string;
  attributes: [string, unknown][];
  /** The layer's map tip (HTML) evaluated for this feature, if it has one. */
  tip?: string;
}

export const ui = $state({
  phase: "booting" as "booting" | "empty" | "loading" | "ready" | "error",
  status: "Starting QGIS engine…",
  error: "",
  projectName: "",
  panel: (view.noPanels || view.mapOnly ? null : "layers") as Panel | null,
  /** Current layer, as in QGIS: target of Style and Table. */
  current: null as string | null,
  /** Project URL when opened with ?url= or the demo, used for share links. */
  sourceUrl: null as string | null,
  /** Layer shown in the attribute table drawer. */
  tableLayerId: null as string | null,
  /** Bumped after every engine mutation; views re-read the engine when it changes. */
  version: 0,
  /** Bumped when layer data changes (edits, field calculator, undo); tables re-read. */
  dataVersion: 0,
  palette: false,
  hits: [] as IdentifyHit[],
  hitAt: null as [number, number] | null,
  toast: "",
  /** Set when an embedded map is shown on a domain its owner didn't approve. */
  embedBlocked: "",
  /** Unsaved edits since the last save. */
  dirty: false,
  /** Layer in edit mode (one at a time, as a GeoPackage write session). */
  editing: null as string | null,
  editTool: null as "add" | "modify" | "delete" | null,
  /** What a click on the map does. */
  mapTool: "identify" as "identify" | "measure-line" | "measure-area" | "select" | "select-box",
  /** A CSV waiting for its import options (see CsvDialog). */
  csvPrompt: null as (import("./csv").CsvPreview & { resolve: (o: import("./csv").CsvOptions | null) => void }) | null,
  /** Selected feature ids per layer. */
  selection: {} as Record<string, number[]>,
  /** Live measurement readout. */
  measure: "",
  /** Show the legend on the map; hover map tips. */
  showLegend: new URLSearchParams(location.search).has("legend"),
  mapTips: false,
  canUndo: false,
  canRedo: false,
  /** Project-level undo/redo (styles, tree, layers). */
  canUndoProject: false,
  canRedoProject: false,
  /** Algorithm to open in the Tools panel (from the command palette). */
  pendingAlgorithm: null as string | null,
  /** Open modal dialog, if any. */
  dialog: null as "project" | "share" | "settings" | "export" | "select-location" | "select-expression" | "export-layer" | "field-calc" | null,
  /** OPFS slot of the open project, once saved in the browser. */
  storedId: null as string | null,
});

export function changed() {
  ui.version++;
}

export function toast(msg: string) {
  ui.toast = msg;
  setTimeout(() => ui.toast === msg && (ui.toast = ""), 4000);
}

export function featureAttributes(f: QgsFeature): [string, unknown][] {
  const fields = f.fields();
  const values = f.attributes();
  return values.map((v, i) => [fields.at(i).name(), v]);
}
