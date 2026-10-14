import type { QgsFeature } from "qgis-js";

const params = new URLSearchParams(location.search);

export const view = {
  url: params.get("url"),
  mapOnly: params.has("maponly"),
  compact: params.get("layout") === "compact",
  noPanels: params.get("panels") === "none",
};

export type Panel = "layers" | "add" | "style" | "tools" | "hub";

export interface IdentifyHit {
  layerId: string;
  layerName: string;
  fid: number;
  title: string;
  attributes: [string, unknown][];
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
  palette: false,
  hits: [] as IdentifyHit[],
  hitAt: null as [number, number] | null,
  toast: "",
  /** Unsaved edits since the last save. */
  dirty: false,
  /** Layer in edit mode (one at a time, as a GeoPackage write session). */
  editing: null as string | null,
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
