import WKB from "ol/format/WKB";
import type Geometry from "ol/geom/Geometry";
import type { QgsVectorLayer } from "qgis-js";
import { layerSource, mapLayerEl, project, child, reload } from "./doc";
import { engine, exists, findMapLayer, free, readFile, writeFile } from "./engine";
import { encodeBlob, openGpkg, tableInfo, writeGpkgTable } from "./gpkg";
import { rows, type Db } from "./sqlite";
import { apply } from "./commit";
import { srid, redraw } from "./map";
import { ui, changed, toast } from "./state.svelte";

/**
 * Feature editing, written straight into the layer's GeoPackage (as QGIS Desktop does).
 * Each change is one SQL statement with its inverse, which gives undo/redo.
 */

type Stmt = [string, unknown[]];
interface Op { label: string; doSql: Stmt[]; undoSql: Stmt[] }

interface Session {
  layerId: string;
  path: string;
  table: string;
  db: Db;
  info: ReturnType<typeof tableInfo>;
  undo: Op[];
  redo: Op[];
}

let session: Session | null = null;
export const editSession = () => session;
const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** Absolute path and table of a GeoPackage-backed layer, or null. */
function gpkgSource(layerId: string) {
  const { provider, datasource } = layerSource(layerId);
  const [file, ...opts] = datasource.split("|");
  if (provider !== "ogr" || !/\.gpkg$/i.test(file)) return null;
  const d = project();
  const path = file.startsWith("/") ? file : `${d.dir}/${file.replace(/^\.\//, "")}`;
  const table = opts.find((o) => o.startsWith("layername="))?.slice(10);
  return exists(path) ? { path, table } : null;
}

export const canEdit = (layerId: string) => !!gpkgSource(layerId);

export async function startEditing(layerId: string) {
  if (session) await stopEditing();
  const src = gpkgSource(layerId);
  if (!src) return toast("Only GeoPackage layers can be edited. Use “Convert to GeoPackage” first.");
  const db = await openGpkg(readFile(src.path));
  const table = src.table ?? rows<{ table_name: string }>(db, "select table_name from gpkg_contents where data_type = 'features' limit 1")[0]?.table_name;
  session = { layerId, path: src.path, table, db, info: tableInfo(db, table), undo: [], redo: [] };
  ui.editing = layerId;
  ui.canUndo = ui.canRedo = false;
  changed();
}

export async function stopEditing() {
  if (!session) return;
  const hadEdits = session.undo.length > 0;
  session.db.close();
  session = null;
  ui.editing = null;
  ui.editTool = null;
  changed();
  redraw();
  if (hadEdits) {
    const { saveInBrowser } = await import("./actions");
    await saveInBrowser();
  }
}

function run(stmts: Stmt[]) {
  const s = session!;
  s.db.run("begin");
  try {
    for (const [sql, params] of stmts) s.db.run(sql, params);
    s.db.run("commit");
  } catch (e) {
    s.db.run("rollback");
    throw e;
  }
}

/** Writes the database back for QGIS and reloads it. */
function flush() {
  const s = session!;
  writeFile(s.path, s.db.export());
  reload();
  ui.dirty = true;
  ui.canUndo = s.undo.length > 0;
  ui.canRedo = s.redo.length > 0;
  changed();
  redraw();
}

function commit(op: Op) {
  const s = session!;
  try {
    run(op.doSql);
  } catch (e) {
    return toast(`Edit failed: ${(e as Error).message}`);
  }
  s.undo.push(op);
  s.redo = [];
  flush();
}

export function undo() {
  const s = session;
  const op = s?.undo.pop();
  if (!s || !op) return;
  run(op.undoSql);
  s.redo.push(op);
  flush();
  toast(`Undid ${op.label}`);
}

export function redo() {
  const s = session;
  const op = s?.redo.pop();
  if (!s || !op) return;
  run(op.doSql);
  s.undo.push(op);
  flush();
}

function row(fid: number) {
  const s = session!;
  const [r] = rows(s.db, `select * from ${q(s.table)} where ${q(s.info.fid)} = ?`, [fid]);
  return r;
}

export function setAttribute(fid: number, field: string, value: unknown) {
  const s = session!;
  const old = row(fid)?.[field] ?? null;
  const sql = `update ${q(s.table)} set ${q(field)} = ? where ${q(s.info.fid)} = ?`;
  commit({ label: `edit ${field}`, doSql: [[sql, [value, fid]]], undoSql: [[sql, [old, fid]]] });
}

export function deleteFeature(fid: number) {
  const s = session!;
  const r = row(fid);
  if (!r) return;
  const cols = Object.keys(r);
  commit({
    label: "delete feature",
    doSql: [[`delete from ${q(s.table)} where ${q(s.info.fid)} = ?`, [fid]]],
    undoSql: [[`insert into ${q(s.table)} (${cols.map(q).join(",")}) values (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c])]],
  });
}

// ---- Geometry ---------------------------------------------------------------------------

const wkbFormat = new WKB({ hex: false });

async function layerTransform() {
  const layerCrs = (findMapLayer(session!.layerId) as QgsVectorLayer).crs();
  const project = srid();
  if (!layerCrs || layerCrs === project) return null;
  const [{ default: proj4 }, { crsByAuthid }] = await Promise.all([import("proj4"), import("./crs")]);
  const from = engine().projectVariables()["project_crs_proj4"];
  const to = (await crsByAuthid(layerCrs))?.proj4;
  return from && to ? proj4(from, to) : null;
}

/** Encodes a geometry drawn on the map (project CRS) for the layer's table. */
async function toBlob(g: Geometry) {
  const s = session!;
  const geom = g.clone();
  const t = await layerTransform();
  if (t) geom.applyTransform((input, output, stride = 2) => {
    const out = output ?? input;
    for (let i = 0; i < input.length; i += stride) [out[i], out[i + 1]] = t.forward([input[i], input[i + 1]]);
    return out;
  });
  if ((geom as never as { getFlatCoordinates(): number[] }).getFlatCoordinates().some((c) => !Number.isFinite(c))) {
    throw new Error("The geometry is outside the area of the layer's coordinate system");
  }
  let olGeom = geom;
  if (s.info.geomType.startsWith("MULTI") && !geom.getType().startsWith("Multi")) {
    const { default: MultiPolygon } = await import("ol/geom/MultiPolygon");
    const { default: MultiLineString } = await import("ol/geom/MultiLineString");
    const { default: MultiPoint } = await import("ol/geom/MultiPoint");
    const c = (geom as never as { getCoordinates(): never }).getCoordinates();
    olGeom = geom.getType() === "Polygon" ? new MultiPolygon([c]) : geom.getType() === "LineString" ? new MultiLineString([c]) : new MultiPoint([c]);
  }
  const wkb = new Uint8Array(wkbFormat.writeGeometry(olGeom) as ArrayBuffer);
  return encodeBlob(wkb, s.info.srsId);
}

export async function addFeature(g: Geometry) {
  const s = session!;
  const blob = await toBlob(g).catch((e) => void toast(e.message));
  if (!blob) return;
  const [{ next }] = rows<{ next: number }>(s.db, `select coalesce(max(${q(s.info.fid)}), 0) + 1 as next from ${q(s.table)}`);
  commit({
    label: "add feature",
    doSql: [[`insert into ${q(s.table)} (${q(s.info.fid)}, ${q(s.info.geom!)}) values (?, ?)`, [next, blob]]],
    undoSql: [[`delete from ${q(s.table)} where ${q(s.info.fid)} = ?`, [next]]],
  });
  return next;
}

export async function setGeometry(fid: number, g: Geometry) {
  const s = session!;
  const old = row(fid)?.[s.info.geom!] ?? null;
  const blob = await toBlob(g);
  const sql = `update ${q(s.table)} set ${q(s.info.geom!)} = ? where ${q(s.info.fid)} = ?`;
  commit({ label: "move vertices", doSql: [[sql, [blob, fid]]], undoSql: [[sql, [old, fid]]] });
}

/** The feature's geometry in project CRS, for the edit overlay. */
export function featureGeometry(fid: number) {
  const api = engine();
  const layer = findMapLayer(session!.layerId) as QgsVectorLayer;
  const req = new api.QgsFeatureRequest();
  req.setFilterFid(fid);
  req.setDestinationCrs(srid());
  const it = layer.getFeatures(req);
  const f = it.nextFeature();
  const json = f?.hasGeometry() ? f.geometry().asJson(10) : null;
  free(f);
  free(it);
  free(req);
  return json;
}



// ---- Converting other formats ---------------------------------------------------------------

const SQL_TYPES: Record<number, "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "DATE" | "DATETIME"> = { 1: "BOOLEAN", 2: "INTEGER", 4: "INTEGER", 6: "REAL", 14: "DATE", 16: "DATETIME" };

/** Copies a layer into a new GeoPackage in data/ and points the layer at it, so it can be edited. */
export async function convertToGpkg(layerId: string) {
  const api = engine();
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const fields = Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i)).filter((f) => f.name().toLowerCase() !== "fid");
  const req = new api.QgsFeatureRequest();
  const it = layer.getFeatures(req);
  const features = [];
  let geomType = "GEOMETRY";
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    const g = f.hasGeometry() ? f.geometry() : null;
    if (g && geomType === "GEOMETRY") geomType = api.QgsWkbTypes.displayString(api.QgsWkbTypes.flatType(g.wkbType())).toUpperCase();
    features.push({ geometry: g ? g.asWkb() : null, attributes: fields.map((fd) => f.attribute(fd.name())) });
    free(f);
  }
  free(it);
  free(req);
  const authid = layer.crs() || "EPSG:4326";
  const [org, code] = authid.split(":");
  const name = layer.name.replace(/[^\w]+/g, "_") || "layer";
  const bytes = await writeGpkgTable(null, {
    name,
    geometryType: geomType,
    srs: { organization: org, code: Number(code), definition: "undefined" },
    fields: fields.map((f) => ({ name: f.name(), type: SQL_TYPES[f.type()] ?? "TEXT" })),
    features,
  });
  const d = project();
  let path = `${d.dir}/data/${name}.gpkg`;
  for (let i = 2; exists(path); i++) path = `${d.dir}/data/${name}_${i}.gpkg`;
  writeFile(path, bytes);
  apply(() => {
    const el = mapLayerEl(layerId)!;
    child(el, "datasource").textContent = `./${path.slice(d.dir.length + 1)}|layername=${name}`;
    child(el, "provider").textContent = "ogr";
    delete d.local[layerId];
  });
  toast(`${layer.name} now uses ${path.split("/").pop()}`);
}
