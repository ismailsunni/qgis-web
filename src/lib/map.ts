import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import Projection from "ol/proj/Projection";
import { ScaleLine, Zoom } from "ol/control";
import { Style, Stroke, Fill, Circle } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import { QgisJobDataSource } from "@qgis-js/ol";
import type { QgsGeometry } from "qgis-js";
import { engine, projectUnits } from "./engine";

let map: Map;
let layer: ImageLayer<QgisJobDataSource>;
let projection: Projection;
const highlight = new VectorSource();
const geojson = new GeoJSON();

const hlColor = "#ffcc00";
const hlStyle = new Style({
  stroke: new Stroke({ color: hlColor, width: 3 }),
  fill: new Fill({ color: "rgba(255,204,0,0.25)" }),
  image: new Circle({ radius: 7, stroke: new Stroke({ color: hlColor, width: 3 }) }),
});

export function createMap(target: HTMLElement, controls: boolean) {
  layer = new ImageLayer();
  map = new Map({
    target,
    controls: controls ? [new Zoom(), new ScaleLine({ bar: true, minWidth: 100 })] : [],
    layers: [layer, new VectorLayer({ source: highlight, style: hlStyle })],
  });
  return map;
}

export const olMap = () => map;
export const srid = () => projection.getCode();

/** Points the map at the currently loaded project, in its own CRS. */
export function showProject() {
  const api = engine();
  projection = new Projection({ code: api.srid(), units: projectUnits() });
  map.setView(new View({ projection, center: [0, 0], resolution: 1 }));
  highlight.clear();
  redraw();
  zoomToFull();
}

/** Re-renders the map from the engine (after visibility, opacity or style changes). */
export function redraw() {
  layer.getSource()?.killPendingJobs();
  layer.setSource(new QgisJobDataSource(engine(), { projection }));
}

export function zoomToFull() {
  const e = engine().fullExtent();
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
  const v = map.getView();
  const res = v.getResolution();
  if (!res) return 0;
  const mpu = projection.getMetersPerUnit() ?? 1;
  return (res * mpu) / 0.00028;
}
