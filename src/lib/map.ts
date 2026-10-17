import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorTileLayer from "ol/layer/VectorTile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type BaseLayer from "ol/layer/Base";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import TileWMS from "ol/source/TileWMS";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import GeoTIFF from "ol/source/GeoTIFF";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import TileArcGISRest from "ol/source/TileArcGISRest";
import { PMTilesRasterSource, PMTilesVectorSource } from "ol-pmtiles";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import GeoJSON from "ol/format/GeoJSON";
import Projection from "ol/proj/Projection";
import { get as getProjection } from "ol/proj";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";
import { ScaleLine, Zoom, Attribution } from "ol/control";
import { Style, Stroke, Fill, Circle } from "ol/style";
import { createDefaultStyle } from "ol/style/Style";
import type { Coordinate } from "ol/coordinate";
import { QgisJobDataSource } from "@qgis-js/ol";
import type { QgsGeometry } from "qgis-js";
import { engine, projectUnits } from "./engine";
import { flatLayers, snapshotTree } from "./tree";
import { drawnByBrowser, remoteSpec, attributionFor, arcgisTiles, type RemoteSpec } from "./remote";
import { hooks, unreachable, mapLayerEl } from "./doc";
import { mbtilesLayer } from "./mbtiles";
import { toast } from "./state.svelte";
import { t } from "./i18n";

let map: Map;
let projection: Projection;
const highlight = new VectorSource();
const highlightLayer = new VectorLayer({ source: highlight, zIndex: 1000 });
/** Overlay layers above the map (edit sketches, selections), managed by their modules. */
export const overlays: BaseLayer[] = [];
const geojson = new GeoJSON();

const hlColor = "#ffcc00";
highlightLayer.setStyle(
  new Style({
    stroke: new Stroke({ color: hlColor, width: 3 }),
    fill: new Fill({ color: "rgba(255,204,0,0.25)" }),
    image: new Circle({ radius: 7, stroke: new Stroke({ color: hlColor, width: 3 }) }),
  }),
);

export function createMap(target: HTMLElement, controls: boolean) {
  map = new Map({
    target,
    controls: controls ? [new Zoom(), new ScaleLine({ bar: true, minWidth: 100 }), new Attribution({ collapsible: true, collapsed: false })] : [],
    layers: [highlightLayer],
  });
  return map;
}

export const olMap = () => map;
export const srid = () => projection.getCode();
export const mapProjection = () => projection;

/** Points the map at the currently loaded project, in its own CRS. */
export function showProject() {
  const api = engine();
  const code = api.srid();
  const def = api.projectVariables()["project_crs_proj4"];
  // Registering the project CRS lets OpenLayers reproject web tiles into it.
  if (def && !getProjection(code)) {
    proj4.defs(code, def);
    register(proj4);
  }
  projection = getProjection(code) ?? new Projection({ code, units: projectUnits() });
  map.setView(new View({ projection, center: [0, 0], resolution: 1 }));
  highlight.clear();
  redraw();
  zoomToFull();
}

let jobs: QgisJobDataSource[] = [];
hooks.beforeReload = () => jobs.forEach((j) => j.killPendingJobs());
const remoteLayers = new globalThis.Map<string, BaseLayer>();

export type StackPiece = { kind: "qgis"; layerIds: string[] } | { kind: "web"; layerId: string; spec: RemoteSpec; opacity: number };

/**
 * The map's layer stack, bottom to top: consecutive QGIS layers share one render (layer ids
 * top-first, as QGIS expects), browser-drawn web layers sit in between. `only` limits it to
 * some layers (compare view).
 */
export function layerStack(only?: Set<string>): StackPiece[] {
  const stack: StackPiece[] = [];
  let segment: string[] = [];
  const flush = () => {
    if (segment.length) stack.push({ kind: "qgis", layerIds: [...segment].reverse() });
    segment = [];
  };
  for (const l of flatLayers(snapshotTree()).filter((n) => (only ? only.has(n.layerId!) : n.visible)).reverse()) {
    const spec = l.remote ? remoteSpec(l.layerId!) : null;
    if (unreachable(l.layerId!)?.kind === "database") continue;
    if (spec && drawnByBrowser(spec)) {
      flush();
      stack.push({ kind: "web", layerId: l.layerId!, spec, opacity: l.opacity ?? 1 });
    } else segment.push(l.layerId!);
  }
  flush();
  return stack;
}

/** OpenLayers layers for a stack (QGIS segments render through the engine). */
export function olLayers(stack: StackPiece[], cache = true): BaseLayer[] {
  return stack.map((p) => {
    if (p.kind === "qgis") {
      const source = new QgisJobDataSource(engine(), { projection, layerIds: p.layerIds });
      jobs.push(source);
      return new ImageLayer({ source });
    }
    const layer = cache ? remoteLayer(p.layerId, p.spec) : createRemoteLayer(p.spec);
    layer.setOpacity(p.opacity);
    return layer;
  });
}

/** Re-renders the map from the engine (after visibility, opacity, style or order changes). */
export function redraw() {
  if (!map || !projection) return;
  jobs.forEach((j) => j.killPendingJobs());
  jobs = [];
  map.getLayers().clear();
  map.getLayers().extend([...olLayers(layerStack()), ...overlays, highlightLayer]);
  hooks.afterRedraw();
}

/** COGs in another CRS (e.g. UTM imagery) need their projection known to be reprojected onto the map. */
function registerLayerCrs(id: string) {
  const srs = mapLayerEl(id)?.querySelector(":scope > srs > spatialrefsys");
  const authid = srs?.querySelector("authid")?.textContent;
  const def = srs?.querySelector("proj4")?.textContent;
  if (authid && def && !getProjection(authid)) {
    proj4.defs(authid, def);
    register(proj4);
  }
}

function remoteLayer(id: string, s: RemoteSpec): BaseLayer {
  if (s.kind === "cog") registerLayerCrs(id);
  const key = id + JSON.stringify(s);
  let layer = remoteLayers.get(key);
  if (!layer) remoteLayers.set(key, (layer = createRemoteLayer(s)));
  return layer;
}

/** A new OpenLayers layer drawing a remote source. */
export function createRemoteLayer(s: RemoteSpec): BaseLayer {
  let layer: BaseLayer;
  const crossOrigin = "anonymous";
  const attributions = attributionFor(s.url) || undefined;
  if (s.kind === "xyz") layer = new TileLayer({ source: new XYZ({ url: s.url, crossOrigin, minZoom: s.zmin, maxZoom: s.zmax, attributions }) });
  else if (s.kind === "wms")
    layer = new TileLayer({ source: new TileWMS({ url: s.url, crossOrigin, projection: "EPSG:3857", params: { LAYERS: s.layer, STYLES: s.style ?? "", FORMAT: s.format ?? "image/png", TRANSPARENT: true } }) });
  // Raster data (and its reprojection) needs the WebGL tile layer.
  else if (s.kind === "cog") layer = new WebGLTileLayer({ source: new GeoTIFF({ sources: [{ url: s.url }], convertToRGB: "auto" }) });
  else if (s.kind === "vectortile") layer = new VectorTileLayer({ source: new VectorTileSource({ format: new MVT(), url: arcgisTiles(s.url) ? `${s.url.replace(/\/$/, "")}/tile/{z}/{y}/{x}.pbf` : s.url, minZoom: s.zmin, maxZoom: s.zmax }) });
  else if (s.kind === "pmtiles") {
    if (s.raster) layer = new TileLayer({ source: new PMTilesRasterSource({ url: s.url, attributions: [] }) as never });
    else {
      // One source per archive, shared by its source layers; each layer draws only its own features.
      let source = pmtilesSources.get(s.url);
      if (!source) pmtilesSources.set(s.url, (source = new PMTilesVectorSource({ url: s.url }) as never));
      layer = new VectorTileLayer({ source, style: (f, r) => (f.get("layer") === s.layer ? createDefaultStyle(f, r) : undefined) });
    }
  }
  else if (s.kind === "mbtiles") layer = mbtilesLayer(s.url, !!s.raster);
  else if (s.kind === "arcgismap") layer = new TileLayer({ source: new TileArcGISRest({ url: s.url, crossOrigin, attributions, params: s.layer ? { LAYERS: `show:${s.layer}`, FORMAT: s.format ?? "png32", TRANSPARENT: true } : { FORMAT: s.format ?? "png32", TRANSPARENT: true } }) });
  else {
    const tile = new TileLayer();
    fetch(s.url)
      .then((r) => r.text())
      .then((xml) => {
        const caps = new WMTSCapabilities().read(xml);
        const opts = optionsFromCapabilities(caps, { layer: s.layer!, matrixSet: s.matrixSet, style: s.style });
        if (opts) tile.setSource(new WMTS({ ...opts, crossOrigin }));
      })
      .catch(() => layerError(s.name));
    layer = tile;
  }
  // A failing web layer gets a named error rather than a silently blank map.
  const source = (layer as TileLayer).getSource?.();
  source?.once?.("tileloaderror" as never, () => layerError(s.name));
  return layer;
}

const pmtilesSources = new globalThis.Map<string, VectorTileSource>();
const failed = new Set<string>();
function layerError(name: string) {
  failed.add(name);
  toast(t("Could not load {names}: the server may block cross-origin requests (CORS) or be offline.", { names: [...failed].join(", ") }));
}

export function zoomToFull() {
  const api = engine();
  // Web layers span the world; fit to the project's own data when there is some.
  const ids = flatLayers(snapshotTree()).filter((l) => !drawnByBrowser(l.remote ? remoteSpec(l.layerId!) : null)).map((l) => l.layerId!);
  const e = ids.length ? api.fullExtent(ids) : api.fullExtent();
  if (!(e.xMaximum > e.xMinimum)) return map.getView().setResolution(projection.getUnits() === "degrees" ? 0.5 : 40000);
  map.getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [40, 40, 40, 40] });
}

export function setHighlight(geoms: QgsGeometry[], zoom = false) {
  highlight.clear();
  for (const g of geoms) if (!g.isNull()) highlight.addFeature(new Feature(geojson.readGeometry(g.asJson(8))!));
  if (zoom && highlight.getFeatures().length) {
    map.getView().fit(highlight.getExtent()!, { padding: [80, 80, 80, 80], maxZoom: map.getView().getZoom()! + 4, duration: 300 });
  }
}

/** Map-unit rectangle of `px` pixels around a coordinate, for identify. */
export function hitBox(c: Coordinate, px = 4) {
  const r = map.getView().getResolution()! * px;
  return new (engine().QgsRectangle)(c[0] - r, c[1] - r, c[0] + r, c[1] + r);
}

export function scaleDenominator() {
  const res = map.getView().getResolution();
  if (!res) return 0;
  return (res * (projection.getMetersPerUnit() ?? 1)) / 0.00028;
}
