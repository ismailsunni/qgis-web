import WKB from "ol/format/WKB";
import type Geometry from "ol/geom/Geometry";
import type { QgsVectorLayer } from "qgis-js";
import { layerSource, mapLayerEl, project, child, reload } from "./doc";
import { engine, exists, findMapLayer, free, readFile, writeFile } from "./engine";
import { encodeBlob, decodeBlob, openGpkg, tableInfo } from "./gpkg";
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
    // Consecutive statements with the same SQL (bulk updates) share one prepared statement.
    for (let i = 0; i < stmts.length; ) {
      let j = i;
      while (j < stmts.length && stmts[j][0] === stmts[i][0]) j++;
      if (j - i === 1) s.db.run(stmts[i][0], stmts[i][1]);
      else {
        const p = s.db.prepare(stmts[i][0]);
        for (let k = i; k < j; k++) p.run(stmts[k][1]);
        p.finalize();
      }
      i = j;
    }
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
  ui.dataVersion++;
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

/** Sets several attributes of a feature as one undoable edit. */
export function setAttributes(fid: number, values: Record<string, unknown>, label = "edit attributes") {
  const s = session!;
  const r = row(fid);
  if (!r) return;
  const entries = Object.entries(values).filter(([k]) => k in r);
  if (!entries.length) return;
  const set = (k: string) => `update ${q(s.table)} set ${q(k)} = ? where ${q(s.info.fid)} = ?`;
  const norm = (v: unknown) => (typeof v === "boolean" ? Number(v) : v instanceof Date ? v.toISOString() : v ?? null);
  commit({ label, doSql: entries.map(([k, v]): Stmt => [set(k), [norm(v), fid]]), undoSql: entries.map(([k]): Stmt => [set(k), [r[k], fid]]) });
}

export function deleteFeature(fid: number) {
  deleteFeatures([fid]);
}

export function deleteFeatures(fids: number[]) {
  const s = session!;
  const doSql: Stmt[] = [];
  const undoSql: Stmt[] = [];
  for (const fid of fids) {
    const r = row(fid);
    if (!r) continue;
    const cols = Object.keys(r);
    doSql.push([`delete from ${q(s.table)} where ${q(s.info.fid)} = ?`, [fid]]);
    undoSql.push([`insert into ${q(s.table)} (${cols.map(q).join(",")}) values (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c])]);
  }
  if (doSql.length) commit({ label: fids.length === 1 ? "delete feature" : `delete ${doSql.length} features`, doSql, undoSql });
}

// ---- Fields ----------------------------------------------------------------------------------

export type FieldType = "TEXT" | "INTEGER" | "REAL" | "DATE" | "DATETIME" | "BOOLEAN";

/** Starts editing the layer, converting it to GeoPackage first if needed (asks). */
export async function ensureEditing(layerId: string) {
  if (session?.layerId === layerId) return true;
  if (!canEdit(layerId)) {
    if (!confirm("This layer isn't a GeoPackage. Copy it into a GeoPackage in the project's data folder so it can be changed?")) return false;
    await convertToGpkg(layerId);
  }
  await startEditing(layerId);
  return session?.layerId === layerId;
}

const columnType = (name: string) => rows<{ name: string; type: string }>(session!.db, `pragma table_info(${q(session!.table)})`).find((c) => c.name === name)?.type ?? "TEXT";

export function addField(name: string, type: FieldType) {
  const s = session!;
  commit({ label: `add field ${name}`, doSql: [[`alter table ${q(s.table)} add column ${q(name)} ${type}`, []]], undoSql: [[`alter table ${q(s.table)} drop column ${q(name)}`, []]] });
}

export function renameField(from: string, to: string) {
  const s = session!;
  commit({ label: `rename field ${from}`, doSql: [[`alter table ${q(s.table)} rename column ${q(from)} to ${q(to)}`, []]], undoSql: [[`alter table ${q(s.table)} rename column ${q(to)} to ${q(from)}`, []]] });
}

export function deleteField(name: string) {
  const s = session!;
  const type = columnType(name);
  const values = rows<Record<string, unknown>>(s.db, `select ${q(s.info.fid)} as fid, ${q(name)} as v from ${q(s.table)} where ${q(name)} is not null`);
  commit({
    label: `delete field ${name}`,
    doSql: [[`alter table ${q(s.table)} drop column ${q(name)}`, []]],
    undoSql: [[`alter table ${q(s.table)} add column ${q(name)} ${type}`, []], ...values.map((r): Stmt => [`update ${q(s.table)} set ${q(name)} = ? where ${q(s.info.fid)} = ?`, [r.v, r.fid]])],
  });
}

/** Writes calculated values (fid → value) into a field, creating it first if `create` is set. */
export function writeField(name: string, values: Map<number, unknown>, create?: FieldType) {
  const s = session!;
  const set = `update ${q(s.table)} set ${q(name)} = ? where ${q(s.info.fid)} = ?`;
  const old = create ? [] : rows<Record<string, unknown>>(s.db, `select ${q(s.info.fid)} as fid, ${q(name)} as v from ${q(s.table)}`);
  const norm = (v: unknown) => (typeof v === "boolean" ? Number(v) : v instanceof Date ? v.toISOString() : v === undefined ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  commit({
    label: `calculate ${name}`,
    doSql: [...(create ? [[`alter table ${q(s.table)} add column ${q(name)} ${create}`, []] as Stmt] : []), ...[...values].map(([fid, v]): Stmt => [set, [norm(v), fid]])],
    undoSql: create ? [[`alter table ${q(s.table)} drop column ${q(name)}`, []]] : old.filter((r) => values.has(r.fid as number)).map((r): Stmt => [set, [r.v, r.fid]]),
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
  return encodeBlob(await toLayerWkb(g), session!.info.srsId);
}

/** WKB in the layer's CRS (and multi type, if the layer is multi) of a map geometry. */
export async function toLayerWkb(g: Geometry) {
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
  return new Uint8Array(wkbFormat.writeGeometry(olGeom) as ArrayBuffer);
}

/** Geometries (WKB, layer CRS) of features of the edit layer. */
export function geometries(fids: number[]) {
  const s = session!;
  const out = new Map<number, Uint8Array>();
  for (const r of rows<{ fid: number; g: Uint8Array | null }>(s.db, `select ${q(s.info.fid)} as fid, ${q(s.info.geom!)} as g from ${q(s.table)} where ${q(s.info.fid)} in (${fids.map(() => "?").join(",")})`, fids)) {
    const d = r.g ? decodeBlob(r.g) : null;
    if (d && !d.empty) out.set(r.fid, d.wkb.slice());
  }
  return out;
}

export const isMultiLayer = () => session!.info.geomType.startsWith("MULTI");

/**
 * One undoable geometry operation: update features, insert copies of features (same attributes)
 * with new geometries, and delete features. Used by merge and split.
 */
export function replaceFeatures(label: string, op: { update?: [number, Uint8Array][]; insert?: [number, Uint8Array][]; remove?: number[] }) {
  const s = session!;
  const doSql: Stmt[] = [];
  const undoSql: Stmt[] = [];
  const set = `update ${q(s.table)} set ${q(s.info.geom!)} = ? where ${q(s.info.fid)} = ?`;
  for (const [fid, wkb] of op.update ?? []) {
    doSql.push([set, [encodeBlob(wkb, s.info.srsId), fid]]);
    undoSql.push([set, [row(fid)?.[s.info.geom!] ?? null, fid]]);
  }
  let [{ next }] = rows<{ next: number }>(s.db, `select coalesce(max(${q(s.info.fid)}), 0) + 1 as next from ${q(s.table)}`);
  for (const [from, wkb] of op.insert ?? []) {
    const r = { ...row(from), [s.info.fid]: next, [s.info.geom!]: encodeBlob(wkb, s.info.srsId) };
    const cols = Object.keys(r);
    doSql.push([`insert into ${q(s.table)} (${cols.map(q).join(",")}) values (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c])]);
    undoSql.push([`delete from ${q(s.table)} where ${q(s.info.fid)} = ?`, [next++]]);
  }
  for (const fid of op.remove ?? []) {
    const r = row(fid);
    if (!r) continue;
    const cols = Object.keys(r);
    doSql.push([`delete from ${q(s.table)} where ${q(s.info.fid)} = ?`, [fid]]);
    undoSql.push([`insert into ${q(s.table)} (${cols.map(q).join(",")}) values (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c])]);
  }
  // Undo runs inserts back before restoring geometries.
  commit({ label, doSql, undoSql: undoSql.reverse() });
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

/** Copies a layer into a new GeoPackage in data/ and points the layer at it, so it can be edited. */
export async function convertToGpkg(layerId: string) {
  const { layerToGpkg } = await import("./export");
  const { bytes, table: name } = await layerToGpkg(layerId);
  const layer = findMapLayer(layerId)!;
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
