import Draw from "ol/interaction/Draw";
import DragBox from "ol/interaction/DragBox";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Map from "ol/Map";
import View from "ol/View";
import { getArea, getLength } from "ol/sphere";
import { getTransform, transform, transformExtent, get as getProjection } from "ol/proj";
import { Style, Stroke, Fill, Circle } from "ol/style";
import type Geometry from "ol/geom/Geometry";
import type { Extent } from "ol/extent";
import type BaseLayer from "ol/layer/Base";
import { IdentifyMode, LayerType, type QgsVectorLayer } from "qgis-js";
import { engine, free } from "./engine";
import { olMap, overlays, mapProjection, hitBox, srid, layerStack, createRemoteLayer } from "./map";
import { flatLayers, snapshotTree } from "./tree";
import { attributionFor } from "./remote";
import { ui } from "./state.svelte";

/** Map tools: measuring, search, legend, map tips and image export. */

// ---- Measuring --------------------------------------------------------------------------

const measureSource = new VectorSource();
const accent = "#e8590c";
overlays.push(
  new VectorLayer({
    source: measureSource,
    zIndex: 998,
    style: new Style({
      stroke: new Stroke({ color: accent, width: 2.5, lineDash: [6, 4] }),
      fill: new Fill({ color: "rgba(232,89,12,0.12)" }),
      image: new Circle({ radius: 4, fill: new Fill({ color: accent }) }),
    }),
  }),
);
let draw: Draw | null = null;

/** Whether OpenLayers can transform the project CRS to WGS 84 (needed for geodesic measures). */
function geodesic() {
  try {
    return !!getProjection(srid()) && !!getTransform(mapProjection(), "EPSG:4326");
  } catch {
    return false;
  }
}

const fmtLength = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km` : `${m.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`);
const fmtArea = (m2: number) =>
  m2 >= 1e6 ? `${(m2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 })} km²` : m2 >= 1e4 ? `${(m2 / 1e4).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : `${m2.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`;

export function measureText(g: Geometry) {
  const projection = mapProjection();
  const mpu = projection.getMetersPerUnit() ?? 1;
  const sphere = geodesic();
  if (g.getType() === "Polygon") {
    const area = sphere ? getArea(g, { projection }) : (g as never as { getArea(): number }).getArea() * mpu * mpu;
    const ring = (g as never as { getLinearRing(i: number): Geometry }).getLinearRing(0);
    const perimeter = sphere ? getLength(ring, { projection }) : (ring as never as { getLength(): number }).getLength() * mpu;
    return `${fmtArea(area)} · perimeter ${fmtLength(perimeter)}${sphere ? "" : " (planar)"}`;
  }
  const length = sphere ? getLength(g, { projection }) : (g as never as { getLength(): number }).getLength() * mpu;
  return `${fmtLength(length)}${sphere ? "" : " (planar)"}`;
}

export function startMeasure(kind: "line" | "area") {
  stopTool();
  ui.mapTool = kind === "line" ? "measure-line" : "measure-area";
  draw = new Draw({ source: measureSource, type: kind === "line" ? "LineString" : "Polygon" });
  draw.on("drawstart", (e) => {
    measureSource.clear();
    e.feature.getGeometry()!.on("change", (ev) => (ui.measure = measureText(ev.target as Geometry)));
  });
  draw.on("drawend", (e) => (ui.measure = measureText(e.feature.getGeometry()!)));
  olMap().addInteraction(draw);
  ui.measure = kind === "line" ? "Click to start measuring; double-click to finish." : "Click to draw an area; double-click to finish.";
}

let box: DragBox | null = null;
/** Rectangle tool used by selection: calls back with the dragged extent (project CRS). */
export function startBoxTool(onBox: (extent: Extent, e: MouseEvent) => void) {
  stopTool();
  ui.mapTool = "select-box";
  box = new DragBox();
  box.on("boxend", (e) => onBox(box!.getGeometry().getExtent(), (e.mapBrowserEvent?.originalEvent ?? {}) as MouseEvent));
  olMap().addInteraction(box);
}

/** Polygon (click vertices) or freehand (drag) shape tool used by selection. */
export function startShapeTool(freehand: boolean, onShape: (g: Geometry, e: MouseEvent) => void) {
  stopTool();
  ui.mapTool = freehand ? "select-freehand" : "select-polygon";
  let last: MouseEvent = new MouseEvent("click");
  draw = new Draw({ source: measureSource, type: "Polygon", freehand, condition: (e) => ((last = e.originalEvent as MouseEvent), true) });
  draw.on("drawend", (e) => {
    onShape(e.feature.getGeometry()!, last);
    setTimeout(() => measureSource.clear());
  });
  olMap().addInteraction(draw);
}

export function stopTool() {
  if (draw) olMap().removeInteraction(draw);
  if (box) olMap().removeInteraction(box);
  draw = box = null;
  measureSource.clear();
  ui.measure = "";
  ui.mapTool = "identify";
}

// ---- Search -----------------------------------------------------------------------------

export interface Place { label: string; lon: number; lat: number; bbox?: [number, number, number, number] }

/** Parses "lat, lon" (decimal or DMS) or projected "x y" coordinates. */
export function parseCoordinate(q: string): { lonlat?: [number, number]; xy?: [number, number] } | null {
  const dms = (part: string) => {
    const m = part.trim().match(/^(-?\d+(?:\.\d+)?)(?:[°\s]+(\d+(?:\.\d+)?)['′\s]*(?:(\d+(?:\.\d+)?)["″]?)?)?\s*([NSEW])?$/i);
    if (!m) return null;
    let v = Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
    if (m[1].startsWith("-") || /[SW]/i.test(m[4] ?? "")) v = -v;
    return { v, hemi: (m[4] ?? "").toUpperCase() };
  };
  const parts = q.split(/[,;]|\s{2,}|\s(?=-?\d)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(dms);
  if (!a || !b) return null;
  // Hemisphere letters decide order; otherwise "lat, lon" when it fits, else project x y.
  if (/[EW]/.test(a.hemi) || /[NS]/.test(b.hemi)) return { lonlat: [a.v, b.v] };
  if (Math.abs(a.v) <= 90 && Math.abs(b.v) <= 180) return { lonlat: [b.v, a.v] };
  return { xy: [a.v, b.v] };
}

/** Place search with OpenStreetMap Nominatim (the query is sent to nominatim.openstreetmap.org). */
export async function searchPlaces(q: string): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "Accept-Language": navigator.language } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (await res.json()).map((r: { display_name: string; lon: string; lat: string; boundingbox: string[] }) => ({
    label: r.display_name,
    lon: +r.lon,
    lat: +r.lat,
    bbox: [+r.boundingbox[2], +r.boundingbox[0], +r.boundingbox[3], +r.boundingbox[1]],
  }));
}

/** Converts WGS 84 to the project CRS (through proj4 or QGIS). */
function fromLonLat(extent: Extent): Extent {
  try {
    if (getProjection(srid())) return transformExtent(extent, "EPSG:4326", srid());
  } catch {}
  const api = engine();
  const r = api.transformRectangle(new api.QgsRectangle(extent[0], extent[1], extent[2], extent[3]), "EPSG:4326", srid());
  return [r.xMinimum, r.yMinimum, r.xMaximum, r.yMaximum];
}

export function goToPlace(p: Place) {
  const view = olMap().getView();
  const e = p.bbox ?? [p.lon - 0.01, p.lat - 0.01, p.lon + 0.01, p.lat + 0.01];
  view.fit(fromLonLat(e), { padding: [60, 60, 60, 60], maxZoom: 18, duration: 400 });
}

export function goToXY(xy: [number, number]) {
  olMap().getView().animate({ center: xy, duration: 400 });
}

export const projectToLonLat = (c: number[]) => {
  try {
    return transform(c, srid(), "EPSG:4326");
  } catch {
    return null;
  }
};

// ---- Legend and map tips ------------------------------------------------------------------

/** The QGIS legend of the visible layers, rendered by the engine (data URL). */
export function legendImage(dpi = 96 * Math.min(2, devicePixelRatio || 1)) {
  const ids = flatLayers(snapshotTree()).filter((l) => l.visible && l.valid).map((l) => l.layerId!);
  return ids.length ? engine().renderLegend(dpi, ids) : "";
}

/** The map tip (or display name) of the topmost feature under a coordinate, evaluated by QGIS. */
export function mapTipAt(coord: number[]): string | null {
  const api = engine();
  const rect = hitBox(coord, 5);
  const results = api.identify(rect, srid(), IdentifyMode.TopDownStopAtFirst);
  free(rect);
  let html: string | null = null;
  for (const r of results) {
    const f = r.features[0];
    if (!html && f && r.layer.type() === LayerType.Vector) {
      const vl = r.layer as QgsVectorLayer;
      const ctx = vl.createExpressionContext();
      ctx.setFeature(f);
      const tip = vl.mapTipTemplate();
      if (tip) html = api.QgsExpression.replaceExpressionText(tip, ctx);
      else if (vl.displayExpression()) {
        const e = new api.QgsExpression(vl.displayExpression());
        const v = e.evaluate(ctx);
        free(e);
        html = v === null || v === undefined ? null : escapeHtml(String(v));
      }
      free(ctx);
    }
    r.features.forEach(free);
  }
  return html;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- Export ------------------------------------------------------------------------------

/** Renders one browser-drawn layer offscreen at the export size and returns its canvas. */
async function renderWebLayer(layer: BaseLayer, extent: Extent, width: number, height: number) {
  const div = Object.assign(document.createElement("div"), { style: `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px` });
  document.body.appendChild(div);
  const map = new Map({ target: div, controls: [], interactions: [], layers: [layer], pixelRatio: 1, view: new View({ projection: mapProjection() }) });
  map.getView().fit(extent, { size: [width, height] });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 20000);
    map.once("rendercomplete", () => (clearTimeout(timer), resolve()));
  });
  const out = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = out.getContext("2d")!;
  for (const c of div.querySelectorAll("canvas")) {
    const opacity = (c.parentElement as HTMLElement).style.opacity;
    ctx.globalAlpha = opacity === "" ? 1 : +opacity;
    ctx.drawImage(c, 0, 0, width, height);
  }
  map.setTarget(undefined);
  div.remove();
  return out;
}

export interface ExportOptions { scale: number; legend: boolean; title: string }

/** Exports the current view as a PNG at `scale` × screen resolution (96 dpi × scale for QGIS). */
export async function exportImage(o: ExportOptions): Promise<Blob> {
  const map = olMap();
  const [w, h] = map.getSize()!;
  const extent = map.getView().calculateExtent([w, h]);
  const W = Math.round(w * o.scale), H = Math.round(h * o.scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const api = engine();
  // Same order as on screen: QGIS segments and web layers, bottom to top.
  for (const piece of layerStack()) {
    if (piece.kind === "qgis") {
      const img = await api.renderImage(srid(), new api.QgsRectangle(extent[0], extent[1], extent[2], extent[3]), W, H, o.scale, piece.layerIds);
      ctx.drawImage(await createImageBitmap(img), 0, 0);
    } else {
      const c = await renderWebLayer(createRemoteLayer(piece.spec), extent, W, H);
      ctx.globalAlpha = piece.opacity;
      ctx.drawImage(c, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  if (o.legend) {
    const url = legendImage(96 * o.scale);
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const pad = 8 * o.scale;
      const x = W - img.width - pad * 2, y = H - img.height - pad * 2;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(x, y, img.width + pad * 2, img.height + pad * 2);
      ctx.drawImage(img, x + pad, y + pad);
    }
  }
  // Credits of the web layers drawn (their terms require them).
  const credits = [...new Set(layerStack().flatMap((p) => (p.kind === "web" ? [attributionFor(p.spec.url)] : [])).filter(Boolean))].join(" · ");
  if (credits) {
    const size = 10 * o.scale;
    ctx.font = `${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(credits).width;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(4 * o.scale, H - size * 1.8, tw + 8 * o.scale, size * 1.8);
    ctx.fillStyle = "#333";
    ctx.fillText(credits, 8 * o.scale, H - size * 0.5);
  }
  if (o.title) {
    const size = 20 * o.scale;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(o.title).width;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(10 * o.scale, 10 * o.scale, tw + 20 * o.scale, size * 1.7);
    ctx.fillStyle = "#1f2421";
    ctx.fillText(o.title, 20 * o.scale, 10 * o.scale + size * 1.2);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png"));
}
