import { olMap, scaleDenominator, mapProjection } from "./map";
import { flatLayers, snapshotTree } from "./tree";
import { treeEl } from "./doc";
import { ui, changed } from "./state.svelte";
import { redraw } from "./map";

/**
 * The map's state in the link (#v=x,y,scale&on=0,2,3&f=1:44): center and scale in the project
 * CRS, the visible layers (by position), and the feature shown in Identify. Opening a shared map
 * with it shows the same view, without changing the project.
 */

export function viewHash() {
  const v = olMap().getView();
  const c = v.getCenter();
  if (!c) return "";
  const layers = flatLayers(snapshotTree());
  const parts = [`v=${c.map((n) => +n.toFixed(5)).join(",")},${Math.round(scaleDenominator())}`, `on=${layers.flatMap((l, i) => (l.visible ? [i] : [])).join(",")}`];
  const hit = ui.hits[0];
  const idx = hit ? layers.findIndex((l) => l.layerId === hit.layerId) : -1;
  if (idx >= 0) parts.push(`f=${idx}:${hit.fid}`);
  return parts.join("&");
}

let timer = 0;
/** Keeps the address bar's hash in step with the map (debounced). */
export function updateHash() {
  clearTimeout(timer);
  timer = window.setTimeout(() => ui.phase === "ready" && history.replaceState(null, "", `${location.pathname}${location.search}#${viewHash()}`), 300);
}

/** The current address with the view, to copy. */
export const viewLink = () => `${location.origin}${location.pathname}${location.search}#${viewHash()}`;

/** Applies a link's view after the project opened. */
export async function applyHash(hash = location.hash.slice(1)) {
  const q = new URLSearchParams(hash);
  const layers = flatLayers(snapshotTree());
  const on = q.get("on");
  if (on !== null) {
    const visible = new Set(on.split(",").filter(Boolean).map(Number));
    // Shown or hidden for this view only: no undo step, no unsaved changes.
    layers.forEach((l, i) => {
      if (l.checked === visible.has(i)) return;
      l.node.itemVisibilityChecked = visible.has(i);
      treeEl(l.key).setAttribute("checked", visible.has(i) ? "Qt::Checked" : "Qt::Unchecked");
    });
    changed();
    redraw();
  }
  const v = q.get("v")?.split(",").map(Number);
  if (v?.length === 3 && v.every(Number.isFinite)) {
    olMap().getView().setCenter([v[0], v[1]]);
    olMap().getView().setResolution((v[2] * 0.00028) / (mapProjection().getMetersPerUnit() ?? 1));
  }
  const [li, fid] = (q.get("f") ?? "").split(":").map(Number);
  if (layers[li]?.layerId && Number.isFinite(fid)) (await import("./actions")).identifyFeature(layers[li].layerId!, fid);
}
