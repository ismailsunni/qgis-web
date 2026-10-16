import { LayerType, type QgsVectorLayer } from "qgis-js";
import { engine, findMapLayer, free } from "./engine";
import { flatLayers, snapshotTree, setVisible, setOpacity } from "./tree";
import { olMap, srid, redraw, scaleDenominator, zoomToFull } from "./map";
import { ui } from "./state.svelte";

/**
 * postMessage API for pages that embed QuarkGIS in an iframe (docs/embed-api.md).
 * Only the direct parent can talk to it, events go only to the origin that said hello, and a
 * published map's embed allowlist applies. Commands change the view, never the saved project.
 */

const embedded = window.parent !== window;
let parentOrigin: string | null = null;
let allowed: string[] = [];

/** A published map's allowed embed domains (set when it is opened). */
export const setAllowedDomains = (domains: string[]) => (allowed = domains);

const originAllowed = (origin: string) => {
  if (!allowed.length) return true;
  const host = new URL(origin).hostname;
  return allowed.some((d) => host === d || host.endsWith("." + d));
};

export function emit(event: string, data: unknown = {}) {
  if (embedded && parentOrigin) window.parent.postMessage({ quarkgis: 1, event, data }, parentOrigin);
}

function layerRef(ref: string) {
  const l = flatLayers(snapshotTree()).find((n) => n.layerId === ref || n.name === ref);
  if (!l) throw new Error(`No layer ${ref}`);
  return l;
}

const lonLatToMap = (lon: number, lat: number) => {
  const api = engine();
  const r = api.transformRectangle(new api.QgsRectangle(lon, lat, lon + 1e-9, lat + 1e-9), "EPSG:4326", srid());
  return [r.xMinimum, r.yMinimum];
};

function viewInfo() {
  const api = engine();
  const [x0, y0, x1, y1] = olMap().getView().calculateExtent(olMap().getSize());
  const r = api.transformRectangle(new api.QgsRectangle(x0, y0, x1, y1), srid(), "EPSG:4326");
  return { bbox: [r.xMinimum, r.yMinimum, r.xMaximum, r.yMaximum], scale: Math.round(scaleDenominator()), crs: srid() };
}

/** GeoJSON (WGS 84) of a layer's features, optionally filtered by a QGIS expression or ids. */
function features(ref: string, opts: { expression?: string; fids?: number[]; limit?: number } = {}) {
  const l = layerRef(ref);
  const layer = findMapLayer(l.layerId!) as QgsVectorLayer;
  if (layer?.type() !== LayerType.Vector) throw new Error(`${ref} is not a vector layer`);
  const api = engine();
  const req = new api.QgsFeatureRequest();
  req.setDestinationCrs("EPSG:4326");
  if (opts.expression) req.setFilterExpression(opts.expression);
  if (opts.fids) req.setFilterFids(opts.fids);
  req.setLimit(Math.min(opts.limit ?? 1000, 10000));
  const names = Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i).name());
  const out = [];
  const it = layer.getFeatures(req);
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    const a = f.attributes();
    out.push({ type: "Feature", id: f.id(), geometry: f.hasGeometry() ? JSON.parse(f.geometry().asJson(7)) : null, properties: Object.fromEntries(names.map((n, i) => [n, a[i] instanceof Date ? (a[i] as Date).toISOString() : a[i]])) });
    free(f);
  }
  free(it);
  free(req);
  return { type: "FeatureCollection", features: out };
}

type Args = Record<string, unknown>;
const commands: Record<string, (a: Args) => unknown | Promise<unknown>> = {
  hello: () => ({ version: 1, project: ui.projectName, ready: ui.phase === "ready" }),
  getLayers: () => flatLayers(snapshotTree()).map((l) => ({ id: l.layerId, name: l.name, visible: l.visible, opacity: l.opacity, valid: l.valid || l.remote })),
  setLayerVisibility: (a) => setVisible(layerRef(String(a.layer)), Boolean(a.visible)),
  setLayerOpacity: (a) => setOpacity(layerRef(String(a.layer)), Number(a.opacity)),
  getView: viewInfo,
  setView: (a) => {
    const view = olMap().getView();
    const [lon, lat] = a.center as [number, number];
    view.setCenter(lonLatToMap(lon, lat));
    if (a.scale) view.setResolution((Number(a.scale) * 0.00028) / (olMap().getView().getProjection().getMetersPerUnit() ?? 1));
    else if (a.zoom !== undefined) view.setZoom(Number(a.zoom));
  },
  fitBounds: (a) => {
    const [w, s, e, n] = a.bbox as number[];
    const p0 = lonLatToMap(w, s), p1 = lonLatToMap(e, n);
    olMap().getView().fit([p0[0], p0[1], p1[0], p1[1]], { padding: [20, 20, 20, 20] });
  },
  zoomToLayer: (a) => {
    const e = engine().fullExtent([layerRef(String(a.layer)).layerId!]);
    olMap().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [20, 20, 20, 20] });
  },
  zoomToFull: () => zoomToFull(),
  getFeatures: (a) => features(String(a.layer), { expression: a.expression as string, limit: a.limit as number }),
  getSelectedFeatures: (a) => features(String(a.layer), { fids: ui.selection[layerRef(String(a.layer)).layerId!] ?? [] }),
  selectByExpression: async (a) => (await import("./selection")).selectByExpression(layerRef(String(a.layer)).layerId!, String(a.expression), (a.mode as never) ?? "new"),
  clearSelection: async () => (await import("./selection")).clearSelection(),
  /** Provider-side filter (QGIS subset string, e.g. an SQL WHERE clause for GeoPackage); not saved. */
  setFilter: (a) => {
    const layer = findMapLayer(layerRef(String(a.layer)).layerId!) as QgsVectorLayer;
    if (!layer.setSubsetString(String(a.filter ?? ""))) throw new Error("The filter was rejected by the data provider");
    redraw();
  },
  exportImage: async (a) => {
    const { exportImage } = await import("./maptools");
    const blob = await exportImage({ scale: Number(a.scale ?? 1), legend: Boolean(a.legend), title: String(a.title ?? "") });
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  },
  openProject: async (a) => (await import("./actions")).openUrl(String(a.url)),
};

if (embedded) {
  window.addEventListener("message", async (e) => {
    const msg = e.data;
    if (e.source !== window.parent || !msg || msg.quarkgis !== 1 || !msg.command || !originAllowed(e.origin)) return;
    parentOrigin ??= e.origin;
    const reply = (body: object) => window.parent.postMessage({ quarkgis: 1, id: msg.id, ...body }, e.origin);
    const fn = commands[msg.command];
    if (!fn) return reply({ ok: false, error: `Unknown command ${msg.command}` });
    try {
      reply({ ok: true, result: (await fn(msg.args ?? {})) ?? null });
    } catch (err) {
      reply({ ok: false, error: (err as Error).message });
    }
  });
}

export const viewChanged = () => emit("viewChanged", viewInfo());
