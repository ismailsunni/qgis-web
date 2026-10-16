import { exportQml, importQml } from "./style";
import { apply } from "./commit";
import GeoJSON from "ol/format/GeoJSON";
import type { QgsVectorLayer } from "qgis-js";
import { engine, findMapLayer, free } from "./engine";
import { srid } from "./map";
import { ui, toast, featureAttributes } from "./state.svelte";
import { t } from "./i18n";

/** Copy/paste of layer styles, as QML (also put on the system clipboard, like QGIS does). */
let copied: { qml: string; from: string } | null = null;

export const hasCopiedStyle = () => !!copied;

export function copyStyle(layerId: string) {
  copied = { qml: exportQml(layerId), from: findMapLayer(layerId)?.name ?? "" };
  navigator.clipboard?.writeText(copied.qml).catch(() => {});
  toast(t("Copied the style of {layer}", { layer: copied.from }));
}

export function pasteStyle(layerId: string) {
  if (!copied) return;
  const qml = copied.qml;
  apply(() => importQml(layerId, qml), "paste style");
}

/** Copy/paste of features between layers: geometry in the map CRS plus attributes by field name. */
let features: { geometry: object; attributes: Record<string, unknown> }[] = [];


export function copyFeatures(layerId: string, fids: number[]) {
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setFilterFids(fids);
  req.setDestinationCrs(srid());
  const it = (findMapLayer(layerId) as QgsVectorLayer).getFeatures(req);
  features = [];
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    if (f.hasGeometry()) features.push({ geometry: JSON.parse(f.geometry().asJson(10)), attributes: Object.fromEntries(featureAttributes(f)) });
    free(f);
  }
  free(it);
  free(req);
  ui.copiedFeatures = features.length;
  toast(features.length === 1 ? t("Copied {n} feature", { n: 1 }) : t("Copied {n} features", { n: features.length }));
}

/** Pastes the copied features into the layer being edited. */
export async function pasteFeatures() {
  if (!ui.editing) return toast(t("Start editing a layer to paste features into it."));
  if (!features.length) return toast(t("Copy features first (select them, then Ctrl+C)."));
  const { insertFeatures } = await import("./editing");
  const geojson = new GeoJSON();
  try {
    const n = await insertFeatures(t("paste {n} features", { n: features.length }), features.map((f) => ({ geometry: geojson.readGeometry(f.geometry)!, attributes: f.attributes })));
    toast(n === 1 ? t("Pasted {n} feature", { n }) : t("Pasted {n} features", { n }));
  } catch (e) {
    toast((e as Error).message);
  }
}
