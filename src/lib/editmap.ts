import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Snap from "ol/interaction/Snap";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";
import type { Interaction } from "ol/interaction";
import { Style, Stroke, Fill, Circle } from "ol/style";
import { IdentifyMode } from "qgis-js";
import { engine, free } from "./engine";
import { olMap, overlays, hitBox, srid } from "./map";
import { symbolKind } from "./style";
import { addFeature, deleteFeature, featureGeometry, setGeometry } from "./editing";
import { ui, toast } from "./state.svelte";

/** Map interactions for editing: sketching new features and moving vertices. */

const source = new VectorSource();
const sketchLayer = new VectorLayer({
  source,
  zIndex: 999,
  style: [
    new Style({
      stroke: new Stroke({ color: "#e8590c", width: 2 }),
      fill: new Fill({ color: "rgba(232,89,12,0.15)" }),
      image: new Circle({ radius: 5, fill: new Fill({ color: "#e8590c" }), stroke: new Stroke({ color: "white", width: 1.5 }) }),
    }),
  ],
});
overlays.push(sketchLayer);
const geojson = new GeoJSON();
let interactions: Interaction[] = [];
let selectedFid: number | null = null;

function clear() {
  const map = olMap();
  interactions.forEach((i) => map.removeInteraction(i));
  interactions = [];
  source.clear();
  selectedFid = null;
}

export function setTool(tool: typeof ui.editTool) {
  clear();
  ui.editTool = tool;
  if (tool !== "add" || !ui.editing) return;
  const kind = symbolKind(ui.editing);
  const type = kind === "marker" ? "Point" : kind === "line" ? "LineString" : "Polygon";
  const draw = new Draw({ source, type });
  draw.on("drawend", async (e) => {
    const fid = await addFeature(e.feature.getGeometry()!);
    setTimeout(() => source.clear());
    if (fid !== undefined) showFeatureForm(fid);
  });
  interactions = [draw];
  olMap().addInteraction(draw);
}

/** Opens the identify panel on a feature of the edit layer so its attributes can be typed in. */
async function showFeatureForm(fid: number) {
  const { identifyFeature } = await import("./actions");
  identifyFeature(ui.editing!, fid);
}

function editLayerHit(coord: Coordinate) {
  const api = engine();
  const rect = hitBox(coord, 6);
  const results = api.identify(rect, srid(), IdentifyMode.TopDownAll);
  free(rect);
  const r = results.find((x) => x.layer.id() === ui.editing);
  const fid = r?.features[0]?.id() ?? null;
  results.forEach((x) => x.features.forEach(free));
  return fid;
}

/** Handles a map click while editing; returns true if it was consumed. */
export function editClick(coord: Coordinate) {
  if (!ui.editing || !ui.editTool || ui.editTool === "add") return ui.editTool === "add";
  const fid = editLayerHit(coord);
  if (fid === null) {
    clear();
    return true;
  }
  if (ui.editTool === "delete") {
    deleteFeature(fid);
    return true;
  }
  // Modify: show the feature's vertices.
  clear();
  selectedFid = fid;
  const json = featureGeometry(fid);
  if (!json) return true;
  const feature = new Feature(geojson.readGeometry(json)!);
  source.addFeature(feature);
  const modify = new Modify({ source });
  modify.on("modifyend", () => setGeometry(selectedFid!, feature.getGeometry()!).catch((e) => toast(e.message)));
  interactions = [modify, new Snap({ source })];
  interactions.forEach((i) => olMap().addInteraction(i));
  return true;
}

export const endEditTools = clear;
