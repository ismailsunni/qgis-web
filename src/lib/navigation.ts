import Graticule from "ol/layer/Graticule";
import { Stroke } from "ol/style";
import { transformExtent } from "ol/proj";
import { mapProjection, olMap, overlays, redraw } from "./map";
import { child, findChild, hooks, project } from "./doc";
import { ui } from "./state.svelte";

/** Map navigation: previous/next extent (QGIS "Zoom Last/Next"), the project's saved view, grid. */

type View = { center: number[]; resolution: number };
let past: View[] = [];
let future: View[] = [];
let current: View | null = null;
let restoring = false;

/** Records each map view (called on moveend). */
export function recordView() {
  const v = olMap().getView();
  const next = { center: v.getCenter()!, resolution: v.getResolution()! };
  if (restoring) restoring = false;
  else if (current && (current.resolution !== next.resolution || current.center.some((c, i) => c !== next.center[i]))) {
    past.push(current);
    if (past.length > 100) past.shift();
    future = [];
  }
  current = next;
  ui.viewHistory = [past.length, future.length];
}

export function resetViews() {
  past = [];
  future = [];
  current = null;
  ui.viewHistory = [0, 0];
}

function go(from: View[], to: View[]) {
  const v = from.pop();
  if (!v) return;
  to.push(current!);
  restoring = true;
  olMap().getView().animate({ ...v, duration: 250 });
}
export const previousView = () => go(past, future);
export const nextView = () => go(future, past);

/** The extent saved with the project by QGIS Desktop (its map canvas), if any. */
export function savedExtent(): number[] | null {
  const ext = project().xml.querySelector('mapcanvas[name="theMapCanvas"] > extent');
  if (!ext) return null;
  const e = ["xmin", "ymin", "xmax", "ymax"].map((k) => Number(findChild(ext, k)?.textContent));
  return e.every(Number.isFinite) && e[2] > e[0] ? e : null;
}

// Saving writes the current view into the project's map canvas, so Desktop opens at the same place.
hooks.beforeSave = () => {
  const xml = project().xml;
  const extent = olMap()?.getView().calculateExtent();
  if (!extent?.every(Number.isFinite)) return;
  let canvas = xml.querySelector('mapcanvas[name="theMapCanvas"]');
  if (!canvas) {
    canvas = xml.documentElement.appendChild(xml.createElement("mapcanvas"));
    canvas.setAttribute("name", "theMapCanvas");
    canvas.setAttribute("annotationsVisible", "1");
  }
  const ext = child(canvas, "extent");
  ["xmin", "ymin", "xmax", "ymax"].forEach((k, i) => (child(ext, k).textContent = String(extent[i])));
  child(canvas, "rotation").textContent ||= "0";
};

const grid = new Graticule({ strokeStyle: new Stroke({ color: "rgba(60,60,60,0.45)", width: 1, lineDash: [3, 3] }), showLabels: true, wrapX: false, zIndex: 999, visible: false });
overlays.push(grid);

export function toggleGrid(on = !grid.getVisible()) {
  // The grid needs the CRS's extent, which projections defined from proj4 strings lack.
  const p = mapProjection();
  if (on && !p.getExtent()) {
    p.setWorldExtent([-180, -85, 180, 85]);
    p.setExtent(transformExtent([-180, -85, 180, 85], "EPSG:4326", p, 64));
  }
  grid.setVisible(on);
  ui.grid = on;
  redraw();
}
