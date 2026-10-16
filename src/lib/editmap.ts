import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Snap from "ol/interaction/Snap";
import Translate from "ol/interaction/Translate";
import PointerInteraction from "ol/interaction/Pointer";
import Collection from "ol/Collection";
import { getCenter } from "ol/extent";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";
import type Geometry from "ol/geom/Geometry";
import type { Interaction } from "ol/interaction";
import { Style, Stroke, Fill, Circle } from "ol/style";
import { IdentifyMode, LayerType, type QgsVectorLayer } from "qgis-js";
import { unByKey } from "ol/Observable";
import { flatLayers, snapshotTree } from "./tree";
import { splitWith } from "./editops";
import { engine, free } from "./engine";
import { olMap, overlays, hitBox, srid } from "./map";
import { symbolKind } from "./style";
import { addFeature, deleteFeature, featureGeometry, setGeometry, setAttributes, updateGeometries } from "./editing";
import { selectFids } from "./selection";
import { defaultValues } from "./forms";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";

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

/** Snapping targets: vertices and edges of the visible vector layers in view (QGIS's "all layers"). */
const snapSource = new VectorSource();
const SNAP_LIMIT = 5000;

function refreshSnap() {
  snapSource.clear();
  if (!ui.editing || !ui.snapping) return;
  const api = engine();
  const [x0, y0, x1, y1] = olMap().getView().calculateExtent(olMap().getSize());
  let n = 0;
  for (const l of flatLayers(snapshotTree()).filter((l) => l.visible && l.valid && l.layerType === LayerType.Vector)) {
    const layer = engine().layerTreeRoot().findLayer(l.layerId!)?.layer() as QgsVectorLayer | undefined;
    if (!layer || n >= SNAP_LIMIT) break;
    const req = new api.QgsFeatureRequest();
    req.setDestinationCrs(srid());
    req.setFilterRect(new api.QgsRectangle(x0, y0, x1, y1));
    req.setLimit(SNAP_LIMIT - n);
    const it = layer.getFeatures(req);
    for (let f = it.nextFeature(); f; f = it.nextFeature(), n++) {
      if (f.hasGeometry()) snapSource.addFeature(new Feature(geojson.readGeometry(f.geometry().asJson(10))!));
      free(f);
    }
    free(it);
    free(req);
  }
}
let snapKey: unknown = null;
let selectedFid: number | null = null;

function clear() {
  const map = olMap();
  interactions.forEach((i) => map.removeInteraction(i));
  interactions = [];
  source.clear();
  selectedFid = null;
  if (snapKey) unByKey(snapKey as never);
  snapKey = null;
  snapSource.clear();
}

/** Adds an interaction plus snapping (to other layers and to the sketch itself). */
function use(...list: Interaction[]) {
  if (ui.snapping) {
    refreshSnap();
    snapKey = olMap().on("moveend", refreshSnap);
    list.push(new Snap({ source: snapSource }), new Snap({ source }));
  }
  interactions = list;
  list.forEach((i) => olMap().addInteraction(i));
}

export function setTool(tool: typeof ui.editTool) {
  clear();
  ui.editTool = tool;
  if (!ui.editing) return;
  if (tool === "add") {
    const kind = symbolKind(ui.editing);
    const type = kind === "marker" ? "Point" : kind === "line" ? "LineString" : "Polygon";
    const draw = new Draw({ source, type });
    draw.on("drawend", async (e) => {
      const fid = await addFeature(e.feature.getGeometry()!);
      setTimeout(() => source.clear());
      if (fid === undefined) return;
      // Default values from the project's form configuration, evaluated by QGIS.
      const defaults = defaultValues(ui.editing!, fid);
      if (Object.keys(defaults).length) setAttributes(fid, defaults, t("default values"));
      showFeatureForm(fid);
    });
    use(draw);
  } else if (tool === "move" || tool === "rotate") {
    transformTool(tool);
  } else if (tool === "split") {
    const draw = new Draw({ source, type: "LineString" });
    draw.on("drawend", (e) => {
      splitWith(e.feature.getGeometry()!).catch((err) => toast(err.message));
      setTimeout(() => source.clear());
    });
    use(draw);
  }
}

/** Move and rotate act on the selected features of the edit layer, shown as an editable sketch. */
function transformTool(tool: "move" | "rotate") {
  const feats = (ui.selection[ui.editing!] ?? []).flatMap((fid) => {
    const json = featureGeometry(fid);
    return json ? [Object.assign(new Feature(geojson.readGeometry(json)!), { fid })] : [];
  });
  if (!feats.length) return;
  source.addFeatures(feats);
  const save = (label: string) => updateGeometries(label, feats.map((f) => [f.fid, f.getGeometry()!])).catch((e) => toast(e.message));
  if (tool === "move") {
    const tr = new Translate({ features: new Collection(feats), hitTolerance: 4 });
    tr.on("translateend", () => save(feats.length === 1 ? t("move {n} feature", { n: 1 }) : t("move {n} features", { n: feats.length })));
    return use(tr);
  }
  // Rotate: drag anywhere; the features turn around the centre of their extent.
  let anchor: number[], start = 0, originals: Geometry[] = [];
  const angle = (c: number[]) => Math.atan2(c[1] - anchor[1], c[0] - anchor[0]);
  use(
    new PointerInteraction({
      handleDownEvent: (e) => {
        anchor = getCenter(source.getExtent()!);
        start = angle(e.coordinate);
        originals = feats.map((f) => f.getGeometry()!.clone());
        return true;
      },
      handleDragEvent: (e) => {
        const a = angle(e.coordinate) - start;
        feats.forEach((f, i) => {
          const g = originals[i].clone();
          g.rotate(a, anchor);
          f.setGeometry(g);
        });
        ui.measure = t("Rotation {angle}°", { angle: (((-a * 180) / Math.PI + 540) % 360 - 180).toFixed(1) });
      },
      handleUpEvent: () => {
        ui.measure = "";
        save(feats.length === 1 ? t("rotate {n} feature", { n: 1 }) : t("rotate {n} features", { n: feats.length }));
        return false;
      },
    }),
  );
}

/** Re-applies the current tool (e.g. after snapping was switched). */
export const resetTool = () => setTool(ui.editTool);

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
  if (!ui.editing || !ui.editTool || ui.editTool === "add" || ui.editTool === "split") return ui.editTool === "add" || ui.editTool === "split";
  const fid = editLayerHit(coord);
  if (fid === null) {
    if (ui.editTool !== "move" && ui.editTool !== "rotate") clear();
    return true;
  }
  if (ui.editTool === "delete") {
    deleteFeature(fid);
    return true;
  }
  if (ui.editTool === "move" || ui.editTool === "rotate") {
    // A click on another feature makes it the one to transform.
    if (!(ui.selection[ui.editing] ?? []).includes(fid)) {
      selectFids(ui.editing, [fid], "new");
      setTool(ui.editTool);
    }
    return true;
  }
  // Modify: show the feature's vertices.
  clear();
  ui.editTool = "modify";
  selectedFid = fid;
  const json = featureGeometry(fid);
  if (!json) return true;
  const feature = new Feature(geojson.readGeometry(json)!);
  source.addFeature(feature);
  const modify = new Modify({ source });
  modify.on("modifyend", () => setGeometry(selectedFid!, feature.getGeometry()!).catch((e) => toast(e.message)));
  use(modify);
  return true;
}

export const endEditTools = clear;
