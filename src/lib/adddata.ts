import { unzipSync, strFromU8, strToU8 } from "fflate";
import { exists, writeFile, findMapLayer } from "./engine";
import { LayerType } from "qgis-js";
import { setDefaultStyle, symbolKind } from "./style";
import { redraw } from "./map";
import { insertLayerXml, newLayerId, project, hasProject, reload, treeRootEl } from "./doc";
import { crsByAuthid, spatialRefSys, type CrsDef } from "./crs";
import { openDb, rows } from "./sqlite";
import { apply } from "./commit";
import { ui, toast, changed } from "./state.svelte";
import { t, N_ } from "./i18n";
import { previewCsv, delimitedTextUri, toCsv, type CsvOptions, type CsvPreview } from "./csv";

/** Formats QGIS (GDAL/OGR) reads in the browser engine. */
export const DATA_EXT = /\.(gpkg|geojson|json|fgb|shp|zip|tif|tiff|kml|gpx|gml|parquet|geoparquet|csv|tsv|txt|xlsx|mbtiles)$/i;
const SIDECAR_EXT = /\.(shx|dbf|prj|cpg|qix|sbn|sbx|qmd|aux\.xml)$/i;

interface Source {
  name: string;
  /** Path relative to the project folder, as stored in the project. */
  datasource: string;
  type: "vector" | "raster" | "vector-tile";
  provider: "ogr" | "gdal" | "delimitedtext" | "vectortile";
  crs: CrsDef | null;
}

/** Asks how to read a CSV (geometry columns, CRS); resolved by the CSV dialog. */
function askCsv(preview: CsvPreview): Promise<CsvOptions | null> {
  return new Promise((resolve) => (ui.csvPrompt = { ...preview, resolve }));
}

/** Asks which tables of a multi-layer file to add (as QGIS's sublayer picker). */
function askLayers(file: string, items: [string, string][]): Promise<string[]> {
  return new Promise((resolve) => (ui.layerPicker = { file, items, resolve }));
}

/** Adds a delimited text file as a QGIS delimitedtext layer, after asking how to read it. */
async function csvSource(name: string, text: string, dataDir: string, rel: (p: string) => string): Promise<Source | null> {
  const opts = await askCsv(previewCsv(name, text));
  if (!opts) return null;
  const target = uniquePath(dataDir, name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt") ? name : `${name}.csv`);
  writeFile(target, strToU8(text));
  const crs = opts.geometry === "none" ? null : await authCrs(opts.crs || "EPSG:4326");
  return { name: baseName(name), datasource: delimitedTextUri(rel(target), opts), type: "vector", provider: "delimitedtext", crs };
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
    if (ext === "csv" || ext === "tsv" || ext === "txt") {
      const src = await csvSource(name, strFromU8(f.data), dataDir, rel);
      if (src) out.push(src);
      continue;
    }
    if (ext === "xlsx") {
      // The engine's GDAL has no Excel driver: each sheet becomes a CSV next to the project.
      const { default: readXlsx } = await import("read-excel-file/browser");
      for (const sheet of await readXlsx(new Blob([f.data as BlobPart]))) {
        if (!sheet.data.length) continue;
        const src = await csvSource(`${baseName(name)}_${sheet.sheet}.csv`.replace(/[^\w.-]+/g, "_"), toCsv(sheet.data), dataDir, rel);
        if (src) out.push(src);
      }
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
        const picked = tables.length > 1 ? await askLayers(name, tables.map((t) => [t.table_name, t.data_type])) : null;
        for (const t of picked ? tables.filter((t) => picked.includes(t.table_name)) : tables) {
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
    if (ext === "mbtiles") {
      // Raster MBTiles open through GDAL, vector ones (pbf tiles) as a QGIS vector tile layer.
      const db = await openDb(f.data);
      const format = rows<{ value: string }>(db, "select value from metadata where name = 'format'")[0]?.value;
      db.close();
      const crs = await authCrs("EPSG:3857");
      out.push(format === "pbf" ? { name: baseName(name), datasource: `type=mbtiles&url=${rel(target)}`, type: "vector-tile", provider: "vectortile", crs } : { name: baseName(name), datasource: rel(target), type: "raster", provider: "gdal", crs });
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
  ui.status = t("Adding data…");
  const data = await Promise.all(files.map(async (f) => ({ path: f.path, data: f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer()) })));
  let sources: Source[];
  try {
    sources = await prepare(data);
  } catch (e) {
    return toast(t("Could not read the data: {error}", { error: (e as Error).message }));
  }
  if (!sources.length) return toast(t("No supported data found (GeoPackage, GeoJSON, Shapefile, FlatGeobuf, GeoTIFF, GeoParquet, KML, GPX)."));
  const ids: string[] = [];
  apply(() => {
    for (const s of sources.reverse()) ids.push(insertLayerXml(mapLayerXml(s), s.name));
  }, N_("add data"));
  // Clean default styles rather than QGIS's random colors (part of the same undo step).
  const vectors = ids.filter((id) => findMapLayer(id)?.type() === LayerType.Vector);
  if (vectors.length) {
    vectors.forEach(setDefaultStyle);
    // Points above lines above polygons above rasters, so new layers don't hide each other.
    const RANK: Record<string, number> = { marker: 0, line: 1, fill: 2 };
    const rank = (id: string) => (vectors.includes(id) ? (RANK[symbolKind(id) ?? ""] ?? 3) : 3);
    const nodes = [...treeRootEl().children].filter((n) => n.tagName === "layer-tree-layer" && ids.includes(n.getAttribute("id")!));
    const anchor = nodes.at(-1)?.nextSibling ?? null;
    for (const n of [...nodes].sort((a, b) => rank(a.getAttribute("id")!) - rank(b.getAttribute("id")!))) treeRootEl().insertBefore(n, anchor);
    reload();
    changed();
    redraw();
  }
  const unknown = sources.filter((s) => !s.crs);
  if (unknown.length) toast(t("No CRS found for {names}; QGIS will use the project CRS.", { names: unknown.map((s) => s.name).join(", ") }));
  ui.current = ids.at(-1) ?? ui.current;
  return ids;
}

/** GeoPackages can carry QGIS projects (qgis_projects table); returns them as .qgz bytes. */
export async function embeddedProjects(gpkg: Uint8Array) {
  const db = await openDb(gpkg).catch(() => null);
  if (!db) return [];
  try {
    // QGIS stores the .qgz either as a blob or as hex text.
    return rows<{ name: string; content: Uint8Array | string }>(db, "select name, content from qgis_projects").map((r) => ({
      name: r.name,
      content: typeof r.content === "string" ? Uint8Array.from(r.content.match(/../g) ?? [], (h) => parseInt(h, 16)) : r.content,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}
