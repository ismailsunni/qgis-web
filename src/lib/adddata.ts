import { unzipSync, strFromU8, strToU8 } from "fflate";
import { exists, writeFile } from "./engine";
import { insertLayerXml, newLayerId, project, hasProject } from "./doc";
import { crsByAuthid, spatialRefSys, type CrsDef } from "./crs";
import { openDb, rows } from "./sqlite";
import { apply } from "./commit";
import { ui, toast } from "./state.svelte";

/** Formats QGIS (GDAL/OGR) reads in the browser engine. */
export const DATA_EXT = /\.(gpkg|geojson|json|fgb|shp|zip|tif|tiff|kml|gpx|gml|parquet|geoparquet|csv)$/i;
const SIDECAR_EXT = /\.(shx|dbf|prj|cpg|qix|sbn|sbx|qmd|aux\.xml)$/i;

interface Source {
  name: string;
  /** Path relative to the project folder, as stored in the project. */
  datasource: string;
  type: "vector" | "raster";
  provider: "ogr" | "gdal";
  crs: CrsDef | null;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mapLayerXml(s: Source, id = newLayerId(s.name)) {
  const srs = s.crs ? `<srs>${spatialRefSys(s.crs)}</srs>` : "";
  return `<maplayer type="${s.type}"><id>${id}</id><datasource>${xmlEsc(s.datasource)}</datasource><layername>${xmlEsc(s.name)}</layername>${srs}<provider encoding="UTF-8">${s.provider}</provider></maplayer>`;
}

const baseName = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");

// ---- CRS detection ---------------------------------------------------------------------

async function authCrs(authid: string | null | undefined) {
  return authid ? crsByAuthid(authid.replace(/^urn:ogc:def:crs:/i, "").replace(/::?/, ":").replace(/^OGC:1\.3:CRS84$/i, "EPSG:4326")) : null;
}

/** Reads the CRS a FlatGeobuf header declares (a tiny FlatBuffers reader). */
async function fgbCrs(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset + 12);
  const u32 = (p: number) => v.getUint32(p, true);
  const table = (t: number) => {
    const vt = t - v.getInt32(t, true);
    const size = v.getUint16(vt, true);
    return (i: number) => (4 + 2 * i < size ? v.getUint16(vt + 4 + 2 * i, true) : 0) || null;
  };
  const str = (p: number) => strFromU8(new Uint8Array(v.buffer, v.byteOffset + p + u32(p) + 4, u32(p + u32(p))));
  const header = u32(0);
  const crsOff = table(header)(10);
  if (!crsOff) return null;
  const crs = header + crsOff + u32(header + crsOff);
  const field = table(crs);
  const org = field(0) ? str(crs + field(0)!) : "EPSG";
  const code = field(1) ? v.getInt32(crs + field(1)!, true) : 0;
  if (code) return authCrs(`${org}:${code}`);
  return field(4) ? { wkt: str(crs + field(4)!) } : null;
}

async function tiffCrs(b: Uint8Array) {
  const { fromArrayBuffer } = await import("geotiff");
  const image = await (await fromArrayBuffer(b.slice().buffer)).getImage();
  const keys = image.getGeoKeys() as Record<string, number> | null;
  const code = keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey;
  return code && code !== 32767 ? authCrs(`EPSG:${code}`) : null;
}

/** GeoParquet isn't readable by the engine's GDAL, so it's converted to GeoJSON. */
async function parquetToGeoJson(b: Uint8Array) {
  const [{ parquetReadObjects, parquetMetadata }, { compressors }] = await Promise.all([import("hyparquet"), import("hyparquet-compressors")]);
  const buf = b.slice().buffer;
  const meta = parquetMetadata(buf);
  const geo = JSON.parse(meta.key_value_metadata?.find((kv) => kv.key === "geo")?.value ?? "{}");
  const column: string = geo.primary_column ?? "geometry";
  const id = geo.columns?.[column]?.crs?.id;
  const rowsData = await parquetReadObjects({ file: buf, compressors });
  const features = rowsData.map((r) => {
    const { [column]: geometry, ...properties } = r as Record<string, unknown>;
    for (const [k, val] of Object.entries(properties)) if (typeof val === "bigint") properties[k] = Number(val);
    return { type: "Feature", geometry, properties };
  });
  const crs = id ? await authCrs(`${id.authority}:${id.code}`) : await authCrs("EPSG:4326");
  return { json: JSON.stringify({ type: "FeatureCollection", features }), crs };
}

// ---- Adding files ----------------------------------------------------------------------

interface DataFile { path: string; data: Uint8Array }

function uniquePath(dir: string, name: string) {
  let p = `${dir}/${name}`;
  for (let i = 2; exists(p); i++) p = `${dir}/${name.replace(/(\.[^.]+)?$/, `_${i}$1`)}`;
  return p;
}

/** Writes data into the project's data/ folder and returns sources to add as layers. */
async function prepare(files: DataFile[]): Promise<Source[]> {
  const d = project();
  const dataDir = `${d.dir}/data`;
  const rel = (abs: string) => "./" + abs.slice(d.dir.length + 1);
  const out: Source[] = [];
  // Shapefiles travel with sidecars: keep their names together.
  const byBase = new Map<string, DataFile[]>();
  for (const f of files) byBase.set(f.path.replace(/\.[^.]+$/, ""), [...(byBase.get(f.path.replace(/\.[^.]+$/, "")) ?? []), f]);

  for (const f of files) {
    const name = f.path.split("/").pop()!;
    const ext = name.split(".").pop()!.toLowerCase();
    if (SIDECAR_EXT.test(name)) continue;
    if (ext === "zip") {
      const entries = unzipSync(f.data);
      out.push(...(await prepare(Object.entries(entries).filter(([n]) => !n.endsWith("/")).map(([n, data]) => ({ path: `${baseName(name)}/${n}`, data })))));
      continue;
    }
    if (ext === "parquet" || ext === "geoparquet") {
      const { json, crs } = await parquetToGeoJson(f.data);
      const target = uniquePath(dataDir, `${baseName(name)}.geojson`);
      writeFile(target, strToU8(json));
      out.push({ name: baseName(name), datasource: rel(target), type: "vector", provider: "ogr", crs });
      continue;
    }
    if (ext === "shp") {
      const folder = uniquePath(dataDir, baseName(name));
      for (const s of byBase.get(f.path.replace(/\.[^.]+$/, "")) ?? [f]) writeFile(`${folder}/${s.path.split("/").pop()}`, s.data);
      const prj = (byBase.get(f.path.replace(/\.[^.]+$/, "")) ?? []).find((s) => /\.prj$/i.test(s.path));
      out.push({ name: baseName(name), datasource: rel(`${folder}/${name}`), type: "vector", provider: "ogr", crs: prj ? { wkt: strFromU8(prj.data) } : null });
      continue;
    }
    const target = uniquePath(dataDir, name);
    writeFile(target, f.data);
    if (ext === "gpkg") {
      const db = await openDb(f.data);
      try {
        const tables = rows<{ table_name: string; data_type: string; organization: string; organization_coordsys_id: number; definition: string }>(
          db,
          "select c.table_name, c.data_type, s.organization, s.organization_coordsys_id, s.definition from gpkg_contents c left join gpkg_spatial_ref_sys s on s.srs_id = c.srs_id where c.data_type in ('features', 'tiles', 'attributes')",
        );
        for (const t of tables) {
          const crs = t.data_type === "attributes" ? null : t.organization?.toUpperCase() === "EPSG" ? await authCrs(`EPSG:${t.organization_coordsys_id}`) : t.definition && t.definition !== "undefined" ? { wkt: t.definition } : null;
          out.push(
            t.data_type === "tiles"
              ? { name: t.table_name, datasource: `GPKG:${rel(target)}:${t.table_name}`, type: "raster", provider: "gdal", crs }
              : { name: t.table_name, datasource: `${rel(target)}|layername=${t.table_name}`, type: "vector", provider: "ogr", crs },
          );
        }
      } finally {
        db.close();
      }
      continue;
    }
    if (ext === "tif" || ext === "tiff") {
      out.push({ name: baseName(name), datasource: rel(target), type: "raster", provider: "gdal", crs: await tiffCrs(f.data).catch(() => null) });
      continue;
    }
    let crs: CrsDef | null = null;
    if (ext === "geojson" || ext === "json") {
      const declared = JSON.parse(strFromU8(f.data))?.crs?.properties?.name;
      crs = await authCrs(declared ?? "EPSG:4326");
    } else if (ext === "fgb") crs = await fgbCrs(f.data).catch(() => null);
    else if (["kml", "gpx"].includes(ext)) crs = await authCrs("EPSG:4326");
    out.push({ name: baseName(name), datasource: rel(target), type: "vector", provider: "ogr", crs });
  }
  return out;
}

/** Adds data files to the open project as new layers (on top of the layer tree). */
export async function addData(files: { path: string; data: Blob | Uint8Array }[]) {
  if (!hasProject() || ui.phase !== "ready") {
    const { newProject } = await import("./actions");
    await newProject();
  }
  ui.status = "Adding data…";
  const data = await Promise.all(files.map(async (f) => ({ path: f.path, data: f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer()) })));
  const sources = await prepare(data);
  if (!sources.length) return toast("No supported data found (GeoPackage, GeoJSON, Shapefile, FlatGeobuf, GeoTIFF, GeoParquet, KML, GPX).");
  const ids: string[] = [];
  apply(() => {
    for (const s of sources.reverse()) ids.push(insertLayerXml(mapLayerXml(s), s.name));
  });
  const unknown = sources.filter((s) => !s.crs);
  if (unknown.length) toast(`No CRS found for ${unknown.map((s) => s.name).join(", ")}; QGIS will use the project CRS.`);
  ui.current = ids.at(-1) ?? ui.current;
  return ids;
}

/** GeoPackages can carry QGIS projects (qgis_projects table); returns them as .qgz bytes. */
export async function embeddedProjects(gpkg: Uint8Array) {
  const db = await openDb(gpkg);
  try {
    return rows<{ name: string; content: Uint8Array }>(db, "select name, content from qgis_projects");
  } catch {
    return [];
  } finally {
    db.close();
  }
}
