import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import { Style, Stroke, Fill, Circle } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import type { Extent } from "ol/extent";
import { FeatureRequestFlag, IdentifyMode, LayerType, type QgsVectorLayer } from "qgis-js";
import { engine, findMapLayer, free } from "./engine";
import { olMap, overlays, hitBox, srid } from "./map";
import { hooks } from "./doc";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";
import { emit } from "./embed";

/**
 * Feature selection, per layer, as in QGIS: yellow on the map, highlighted in the attribute table,
 * used by zoom, export, field calculation and editing. Not saved in the project (QGIS doesn't either).
 */

export type SelectMode = "new" | "add" | "remove" | "intersect";

const source = new VectorSource();
const yellow = "#ffeb3b";
overlays.push(
  new VectorLayer({
    source,
    zIndex: 997,
    style: new Style({
      stroke: new Stroke({ color: "#f9a825", width: 2 }),
      fill: new Fill({ color: "rgba(255,235,59,0.45)" }),
      image: new Circle({ radius: 6, fill: new Fill({ color: yellow }), stroke: new Stroke({ color: "#f9a825", width: 2 }) }),
    }),
  }),
);
const geojson = new GeoJSON();

export const selected = (layerId: string) => ui.selection[layerId] ?? [];

function setSelection(layerId: string, fids: number[], mode: SelectMode) {
  const cur = new Set(selected(layerId));
  let next: number[];
  if (mode === "add") next = [...new Set([...cur, ...fids])];
  else if (mode === "remove") next = [...cur].filter((f) => !fids.includes(f));
  else if (mode === "intersect") next = fids.filter((f) => cur.has(f));
  else next = [...new Set(fids)];
  if (next.length) ui.selection = { ...ui.selection, [layerId]: next };
  else {
    const { [layerId]: _, ...rest } = ui.selection;
    ui.selection = rest;
  }
  refresh();
  emit("selectionChanged", { layer: layerId, ids: next });
}

/** Re-reads selected geometries from QGIS (in the project CRS) for the highlight. */
export function refresh() {
  source.clear();
  const api = engine();
  for (const [layerId, fids] of Object.entries(ui.selection)) {
    const layer = findMapLayer(layerId) as QgsVectorLayer | null;
    if (!layer || !fids.length) continue;
    const req = new api.QgsFeatureRequest();
    req.setFilterFids(fids.slice(0, 50_000));
    req.setDestinationCrs(srid());
    const it = layer.getFeatures(req);
    for (let f = it.nextFeature(); f; f = it.nextFeature()) {
      if (f.hasGeometry()) {
        const g = geojson.readGeometry(f.geometry().asJson(8));
        if (g) source.addFeature(new Feature(g));
      }
      free(f);
    }
    free(it);
    free(req);
  }
}
// Layers can change (edits, reloads): keep the highlight in step.
hooks.afterRedraw = () => Object.keys(ui.selection).length && refresh();

/** The layer selection tools act on: the current vector layer. */
function targetLayer() {
  const l = ui.current ? findMapLayer(ui.current) : null;
  return l && l.type() === LayerType.Vector ? (l as QgsVectorLayer) : null;
}

export const modeFrom = (e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): SelectMode =>
  e.shiftKey ? "add" : e.ctrlKey || e.metaKey ? "remove" : "new";

/** Click selection: the topmost feature of the current layer under the pointer. */
export function selectAt(coord: Coordinate, mode: SelectMode) {
  const layer = targetLayer();
  if (!layer) return toast(t("Select a vector layer in the Layers panel first."));
  const api = engine();
  const rect = hitBox(coord, 4);
  const results = api.identify(rect, srid(), IdentifyMode.TopDownAll);
  free(rect);
  const hit = results.find((r) => r.layer.id() === layer.id());
  const fids = hit ? [hit.features[0].id()] : [];
  results.forEach((r) => r.features.forEach(free));
  setSelection(layer.id(), fids, mode === "new" && !fids.length ? "new" : mode);
}

/** Rectangle selection (extent in the project CRS). */
export function selectInExtent(extent: Extent, mode: SelectMode) {
  const layer = targetLayer();
  if (!layer) return toast(t("Select a vector layer in the Layers panel first."));
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setDestinationCrs(srid());
  req.setFilterRect(new api.QgsRectangle(extent[0], extent[1], extent[2], extent[3]));
  req.setFlags(FeatureRequestFlag.ExactIntersect);
  const fids = collect(layer, req);
  setSelection(layer.id(), fids, mode);
}

/** Polygon or freehand selection (geometry in the project CRS), exact intersection by GEOS. */
export async function selectInPolygon(polygon: import("ol/geom/Geometry").default, mode: SelectMode) {
  const layer = targetLayer();
  if (!layer) return toast(t("Select a vector layer in the Layers panel first."));
  const [{ geosOps }, { default: WKB }] = await Promise.all([import("./processing"), import("ol/format/WKB")]);
  const g = await geosOps();
  const shape = g.read(new Uint8Array(new WKB({ hex: false }).writeGeometry(polygon) as ArrayBuffer));
  const prepared = g.geos.GEOSPrepare(shape);
  const api = engine();
  const [x0, y0, x1, y1] = polygon.getExtent();
  const req = new api.QgsFeatureRequest();
  req.setDestinationCrs(srid());
  req.setFilterRect(new api.QgsRectangle(x0, y0, x1, y1));
  const it = layer.getFeatures(req);
  const fids: number[] = [];
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    if (f.hasGeometry()) {
      const x = g.read(f.geometry().asWkb());
      if (g.geos.GEOSPreparedIntersects(prepared, x) === 1) fids.push(f.id());
      g.geos.GEOSGeom_destroy(x);
    }
    free(f);
  }
  free(it);
  free(req);
  g.geos.GEOSPreparedGeom_destroy(prepared);
  g.geos.GEOSGeom_destroy(shape);
  setSelection(layer.id(), fids, mode);
}

function collect(layer: QgsVectorLayer, req: InstanceType<ReturnType<typeof engine>["QgsFeatureRequest"]>) {
  const it = layer.getFeatures(req);
  const fids: number[] = [];
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    fids.push(f.id());
    free(f);
  }
  free(it);
  free(req);
  return fids;
}

/** Select by expression, evaluated by QGIS. Returns the number of matching features. */
export function selectByExpression(layerId: string, expression: string, mode: SelectMode) {
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setFilterExpression(expression);
  req.setFlags(FeatureRequestFlag.NoGeometry);
  const fids = collect(layer, req);
  setSelection(layerId, fids, mode);
  return fids.length;
}

/** Select by location: features of `layerId` intersecting features of `otherId` (GEOS). */
export async function selectByLocation(layerId: string, otherId: string, mode: SelectMode) {
  const { intersectingFids } = await import("./processing");
  const fids = await intersectingFids(layerId, otherId);
  setSelection(layerId, fids, mode);
  return fids.length;
}

export function selectFids(layerId: string, fids: number[], mode: SelectMode = "new") {
  setSelection(layerId, fids, mode);
}

export function selectAll(layerId: string) {
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setFlags(FeatureRequestFlag.NoGeometry);
  setSelection(layerId, collect(findMapLayer(layerId) as QgsVectorLayer, req), "new");
}

export function invertSelection(layerId: string) {
  const cur = new Set(selected(layerId));
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setFlags(FeatureRequestFlag.NoGeometry);
  setSelection(layerId, collect(findMapLayer(layerId) as QgsVectorLayer, req).filter((f) => !cur.has(f)), "new");
}

export function clearSelection(layerId?: string) {
  if (layerId) setSelection(layerId, [], "new");
  else {
    ui.selection = {};
    refresh();
  }
}

export function zoomToSelection() {
  const extent = source.getExtent();
  if (!extent || !source.getFeatures().length) return;
  olMap().getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 16, duration: 300 });
}
