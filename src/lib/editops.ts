import type Geometry from "ol/geom/Geometry";
import { geosOps, toMulti } from "./processing";
import { geometries, isMultiLayer, replaceFeatures, toLayerWkb, editSession } from "./editing";
import { ui, toast } from "./state.svelte";
import { wkbBounds } from "./gpkg";
import { t } from "./i18n";

/** Merge and split for the edit layer, computed with GEOS in the layer's CRS. */

const typeOf = (wkb: Uint8Array) => new DataView(wkb.buffer, wkb.byteOffset).getUint32(1, wkb[0] === 1) % 1000;

/** Merges the selected features into the first one (its attributes are kept), as QGIS does. */
export async function mergeSelected() {
  const s = editSession();
  const fids = s ? [...(ui.selection[s.layerId] ?? [])].sort((a, b) => a - b) : [];
  if (fids.length < 2) return toast(t("Select two or more features of the layer being edited."));
  const g = await geosOps();
  const merged = g.union([...geometries(fids).values()]);
  if (!merged) return toast(t("Nothing to merge."));
  const type = typeOf(merged);
  if (!isMultiLayer() && type >= 4) return toast(t("The merged features don't touch: this single-part layer can't store a multipart result."));
  replaceFeatures(t("merge {n} features", { n: fids.length }), { update: [[fids[0], isMultiLayer() ? toMulti(merged)! : merged]], remove: fids.slice(1) });
  ui.selection = { ...ui.selection, [s!.layerId]: [fids[0]] };
}

/** Splits the selected multipart features into one feature per part (copying the attributes). */
export async function explodeSelected() {
  const s = editSession();
  const fids = s ? (ui.selection[s.layerId] ?? []) : [];
  if (!fids.length) return toast(t("Select multipart features of the layer being edited."));
  const g = await geosOps();
  const update: [number, Uint8Array][] = [];
  const insert: [number, Uint8Array][] = [];
  for (const [fid, wkb] of geometries(fids)) {
    const geom = g.read(wkb);
    const parts = g.parts(geom);
    g.geos.GEOSGeom_destroy(geom);
    if (parts.length < 2) continue;
    const fit = (p: Uint8Array) => (isMultiLayer() ? toMulti(p)! : p);
    update.push([fid, fit(parts[0])]);
    for (const p of parts.slice(1)) insert.push([fid, fit(p)]);
  }
  if (!update.length) return toast(t("The selected features have a single part."));
  replaceFeatures(update.length === 1 ? t("explode {n} feature", { n: 1 }) : t("explode {n} features", { n: update.length }), { update, insert });
  toast(t("Exploded into {n} features", { n: update.length + insert.length }));
}

/** Splits polygons and lines of the edit layer crossed by a line drawn on the map. */
export async function splitWith(line: Geometry) {
  const s = editSession();
  if (!s) return;
  const g = await geosOps();
  const cutWkb = await toLayerWkb(line);
  const cut = g.read(cutWkb);
  // Only the selected features if there is a selection, else every feature the line crosses.
  const sel = ui.selection[s.layerId];
  const candidates = sel?.length ? geometries(sel) : geometries(intersecting(cutWkb));
  const update: [number, Uint8Array][] = [];
  const insert: [number, Uint8Array][] = [];
  for (const [fid, wkb] of candidates) {
    const f = g.read(wkb);
    if (!g.geos.GEOSIntersects(f, cut)) {
      g.geos.GEOSGeom_destroy(f);
      continue;
    }
    let pieces: Uint8Array[] = [];
    const isPolygon = [3, 6].includes(typeOf(wkb));
    if (isPolygon) {
      const lines = g.geos.GEOSUnion(g.geos.GEOSBoundary(f), cut);
      const polys = g.polygonize(lines);
      for (const p of g.parts(polys)) {
        const pg = g.read(p);
        const inside = g.geos.GEOSPointOnSurface(pg);
        if (g.geos.GEOSContains(f, inside)) pieces.push(p);
        g.geos.GEOSGeom_destroy(inside);
        g.geos.GEOSGeom_destroy(pg);
      }
      g.geos.GEOSGeom_destroy(polys);
      g.geos.GEOSGeom_destroy(lines);
    } else {
      const noded = g.geos.GEOSUnion(f, cut);
      pieces = g.parts(noded).filter((p) => {
        const pg = g.read(p);
        const keep = g.geos.GEOSCovers(f, pg) === 1;
        g.geos.GEOSGeom_destroy(pg);
        return keep;
      });
      g.geos.GEOSGeom_destroy(noded);
    }
    g.geos.GEOSGeom_destroy(f);
    if (pieces.length < 2) continue;
    const fit = (p: Uint8Array) => (isMultiLayer() ? toMulti(p)! : p);
    update.push([fid, fit(pieces[0])]);
    for (const p of pieces.slice(1)) insert.push([fid, fit(p)]);
  }
  g.geos.GEOSGeom_destroy(cut);
  if (!update.length) return toast(t("The line doesn't split any feature (it must cross it completely)."));
  replaceFeatures(update.length === 1 ? t("split {n} feature", { n: 1 }) : t("split {n} features", { n: update.length }), { update, insert });
  toast(t("Split into {n} features", { n: update.length + insert.length }));
}

/** Features of the edit layer whose bounding box meets the cut line's (from the GeoPackage R-tree). */
function intersecting(cutWkb: Uint8Array) {
  const s = editSession()!;
  const [x0, y0, x1, y1] = wkbBounds(cutWkb)!;
  const rtree = `rtree_${s.table}_${s.info.geom}`;
  try {
    return s.db.rows<{ id: number }>(`select id from "${rtree.replaceAll('"', '""')}" where maxx >= ? and minx <= ? and maxy >= ? and miny <= ?`, [x0, x1, y0, y1]).map((r) => r.id);
  } catch {
    return s.db.rows<{ fid: number }>(`select "${s.info.fid}" as fid from "${s.table}"`).map((r) => r.fid);
  }
}
