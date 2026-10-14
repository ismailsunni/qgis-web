import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorTileLayer from "ol/layer/VectorTile";
import type BaseLayer from "ol/layer/Base";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import TileWMS from "ol/source/TileWMS";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import GeoTIFF from "ol/source/GeoTIFF";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import GeoJSON from "ol/format/GeoJSON";
import Projection from "ol/proj/Projection";
import { get as getProjection } from "ol/proj";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";
import { ScaleLine, Zoom } from "ol/control";
import { Style, Stroke, Fill, Circle } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import { QgisJobDataSource } from "@qgis-js/ol";
import type { QgsGeometry } from "qgis-js";
import { engine, projectUnits } from "./engine";
import { flatLayers, snapshotTree } from "./tree";
import { drawnByBrowser, remoteSpec, type RemoteSpec } from "./remote";

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
    controls: controls ? [new Zoom(), new ScaleLine({ bar: true, minWidth: 100 })] : [],
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
const remoteLayers = new globalThis.Map<string, BaseLayer>();

/** Re-renders the map from the engine (after visibility, opacity, style or order changes). */
export function redraw() {
  if (!map || !projection) return;
  jobs.forEach((j) => j.killPendingJobs());
  jobs = [];
  const stack: BaseLayer[] = [];
  let segment: string[] = [];
  const flush = () => {
    if (!segment.length) return;
    const source = new QgisJobDataSource(engine(), { projection, layerIds: [...segment].reverse() });
    jobs.push(source);
    stack.push(new ImageLayer({ source }));
    segment = [];
  };
  // Bottom to top: consecutive QGIS layers share one render, browser-drawn ones sit in between.
  for (const l of flatLayers(snapshotTree()).filter((n) => n.visible).reverse()) {
    const spec = l.remote ? remoteSpec(l.layerId!) : null;
    if (spec && drawnByBrowser(spec)) {
      flush();
      const layer = remoteLayer(l.layerId!, spec);
      layer.setOpacity(l.opacity ?? 1);
      stack.push(layer);
    } else segment.push(l.layerId!);
  }
  flush();
  map.getLayers().clear();
  map.getLayers().extend([...stack, ...overlays, highlightLayer]);
}

function remoteLayer(id: string, s: RemoteSpec): BaseLayer {
  const key = id + JSON.stringify(s);
  let layer = remoteLayers.get(key);
  if (layer) return layer;
  const crossOrigin = "anonymous";
  if (s.kind === "xyz") layer = new TileLayer({ source: new XYZ({ url: s.url, crossOrigin, minZoom: s.zmin, maxZoom: s.zmax }) });
  else if (s.kind === "wms")
    layer = new TileLayer({ source: new TileWMS({ url: s.url, crossOrigin, projection: "EPSG:3857", params: { LAYERS: s.layer, STYLES: s.style ?? "", FORMAT: s.format ?? "image/png", TRANSPARENT: true } }) });
  else if (s.kind === "cog") layer = new TileLayer({ source: new GeoTIFF({ sources: [{ url: s.url }], convertToRGB: "auto" }) as never });
  else if (s.kind === "vectortile") layer = new VectorTileLayer({ source: new VectorTileSource({ format: new MVT(), url: s.url, minZoom: s.zmin, maxZoom: s.zmax }) });
  else {
    const tile = new TileLayer();
    fetch(s.url)
      .then((r) => r.text())
      .then((xml) => {
        const caps = new WMTSCapabilities().read(xml);
        const opts = optionsFromCapabilities(caps, { layer: s.layer!, matrixSet: s.matrixSet, style: s.style });
        if (opts) tile.setSource(new WMTS({ ...opts, crossOrigin }));
      })
      .catch(() => {});
    layer = tile;
  }
  remoteLayers.set(key, layer);
  return layer;
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
