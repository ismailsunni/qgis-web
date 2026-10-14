import { openDb, rows, type Db } from "./sqlite";

/** GeoPackage geometry blobs (header + WKB) and the SQL functions GDAL's triggers expect. */

type Bounds = [number, number, number, number];

/** Bounds of a WKB geometry (2D, any type, any byte order). */
export function wkbBounds(wkb: Uint8Array): Bounds | null {
  const v = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let o = 0;
  const geom = () => {
    const le = v.getUint8(o) === 1;
    let type = v.getUint32(o + 1, le);
    o += 5;
    const hasZ = (type & 0x80000000) !== 0 || (type % 10000 >= 1000 && type % 10000 < 2000) || (type % 10000 >= 3000);
    const hasM = (type & 0x40000000) !== 0 || (type % 10000 >= 2000);
    if (type & 0x20000000) o += 4; // EWKB SRID
    type = (type & 0x0fffffff) % 1000;
    const dim = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
    const pt = () => {
      const x = v.getFloat64(o, le), y = v.getFloat64(o + 8, le);
      if (!Number.isNaN(x)) (b[0] = Math.min(b[0], x)), (b[1] = Math.min(b[1], y)), (b[2] = Math.max(b[2], x)), (b[3] = Math.max(b[3], y));
      o += 8 * dim;
    };
    const n = () => {
      const c = v.getUint32(o, le);
      o += 4;
      return c;
    };
    if (type === 1) pt();
    else if (type === 2 || type === 8) for (let i = n(); i > 0; i--) pt();
    else if (type === 3 || type === 17) for (let r = n(); r > 0; r--) for (let i = n(); i > 0; i--) pt();
    else for (let g = n(); g > 0; g--) geom();
  };
  geom();
  return b[0] === Infinity ? null : b;
}

/** Splits a GeoPackage blob into its header info and WKB. */
export function decodeBlob(blob: Uint8Array) {
  if (!blob || blob[0] !== 0x47 || blob[1] !== 0x50) return null;
  const flags = blob[3];
  const le = (flags & 1) === 1;
  const envelope = (flags >> 1) & 7;
  const empty = ((flags >> 4) & 1) === 1;
  const envLen = [0, 32, 48, 48, 64][envelope] ?? 0;
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const srsId = v.getInt32(4, le);
  const bounds: Bounds | null = envelope ? [v.getFloat64(8, le), v.getFloat64(24, le), v.getFloat64(16, le), v.getFloat64(32, le)] : null;
  const wkb = blob.subarray(8 + envLen);
  return { srsId, empty, wkb, bounds: bounds ?? (empty ? null : wkbBounds(wkb)) };
}

export function encodeBlob(wkb: Uint8Array, srsId: number) {
  const bounds = wkbBounds(wkb);
  const out = new Uint8Array(8 + (bounds ? 32 : 0) + wkb.length);
  const v = new DataView(out.buffer);
  out.set([0x47, 0x50, 0, 1 | (bounds ? 2 : 0) | (bounds ? 0 : 16)]);
  v.setInt32(4, srsId, true);
  if (bounds) [bounds[0], bounds[2], bounds[1], bounds[3]].forEach((x, i) => v.setFloat64(8 + i * 8, x, true));
  out.set(wkb, 8 + (bounds ? 32 : 0));
  return out;
}

/** Registers the ST_* functions used by GeoPackage R-tree triggers (provided by GDAL normally). */
export function registerSpatialFunctions(db: Db) {
  const b = (blob: Uint8Array | null) => (blob ? decodeBlob(blob) : null);
  db.fn("ST_IsEmpty", (g: Uint8Array | null) => (g ? (b(g)?.empty || !b(g)?.bounds ? 1 : 0) : null));
  db.fn("ST_MinX", (g: Uint8Array | null) => b(g)?.bounds?.[0] ?? null);
  db.fn("ST_MinY", (g: Uint8Array | null) => b(g)?.bounds?.[1] ?? null);
  db.fn("ST_MaxX", (g: Uint8Array | null) => b(g)?.bounds?.[2] ?? null);
  db.fn("ST_MaxY", (g: Uint8Array | null) => b(g)?.bounds?.[3] ?? null);
  db.fn("GPKG_IsAssignable", (_a: unknown, _b: unknown) => 1);
}

export async function openGpkg(bytes?: Uint8Array) {
  const db = await openDb(bytes);
  registerSpatialFunctions(db);
  return db;
}

export function tableInfo(db: Db, table: string) {
  const cols = rows<{ name: string; type: string; pk: number }>(db, `pragma table_info("${table.replaceAll('"', '""')}")`);
  const [geomCol] = rows<{ column_name: string; geometry_type_name: string; srs_id: number }>(db, "select column_name, geometry_type_name, srs_id from gpkg_geometry_columns where table_name = ?", [table]);
  return {
    fid: cols.find((c) => c.pk)?.name ?? "fid",
    geom: geomCol?.column_name ?? null,
    geomType: geomCol?.geometry_type_name ?? "",
    srsId: geomCol?.srs_id ?? 0,
    columns: cols.map((c) => c.name),
  };
}

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

export interface NewTable {
  name: string;
  geometryType: string; // GEOMETRY, POINT, MULTIPOLYGON…
  srs: { organization: string; code: number; definition: string };
  fields: { name: string; type: "INTEGER" | "REAL" | "TEXT" | "BLOB" | "DATE" | "DATETIME" | "BOOLEAN" }[];
  features: { geometry: Uint8Array | null; attributes: unknown[] }[];
}

/** Adds a feature table to a GeoPackage (created if `bytes` is empty). */
export async function writeGpkgTable(bytes: Uint8Array | null, t: NewTable) {
  const db = await openGpkg(bytes ?? undefined);
  if (!bytes) {
    db.run("PRAGMA application_id = 1196444487; PRAGMA user_version = 10400;");
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', NULL), ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', NULL);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));`);
  }
  let srsId = t.srs.code;
  const [existing] = rows<{ srs_id: number }>(db, "select srs_id from gpkg_spatial_ref_sys where organization = ? and organization_coordsys_id = ?", [t.srs.organization, t.srs.code]);
  if (existing) srsId = existing.srs_id;
  else {
    if (rows(db, "select 1 from gpkg_spatial_ref_sys where srs_id = ?", [srsId]).length) srsId = 100000 + Math.floor(Math.random() * 100000);
    db.run("insert into gpkg_spatial_ref_sys values (?, ?, ?, ?, ?, NULL)", [`${t.srs.organization}:${t.srs.code}`, srsId, t.srs.organization, t.srs.code, t.srs.definition]);
  }
  db.run(`CREATE TABLE ${q(t.name)} (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB${t.fields.map((f) => `, ${q(f.name)} ${f.type}`).join("")})`);
  const insertSql = `insert into ${q(t.name)} (geom${t.fields.map((f) => ", " + q(f.name)).join("")}) values (?${", ?".repeat(t.fields.length)})`;
  db.run("begin");
  const all: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of t.features) {
    const blob = f.geometry ? encodeBlob(f.geometry, srsId) : null;
    const bb = f.geometry ? wkbBounds(f.geometry) : null;
    if (bb) (all[0] = Math.min(all[0], bb[0])), (all[1] = Math.min(all[1], bb[1])), (all[2] = Math.max(all[2], bb[2])), (all[3] = Math.max(all[3], bb[3]));
    db.run(insertSql, [blob, ...f.attributes.map((a) => (typeof a === "boolean" ? Number(a) : a === undefined ? null : a))]);
  }
  db.run("commit");
  const finite = all[0] !== Infinity;
  db.run("insert into gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) values (?, 'features', ?, ?, ?, ?, ?, ?)", [t.name, t.name, ...(finite ? all : [null, null, null, null]), srsId]);
  db.run("insert into gpkg_geometry_columns values (?, 'geom', ?, ?, 0, 0)", [t.name, t.geometryType, srsId]);
  const out = db.export();
  db.close();
  return out;
}
