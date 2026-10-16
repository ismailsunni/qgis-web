import type { QgsVectorLayer } from "qgis-js";
import { engine, findMapLayer, free } from "./engine";
import { writeGpkgTable, type NewTable } from "./gpkg";

/** Layer export: GeoPackage, GeoJSON or CSV, optionally only some features. */

const SQL_TYPES: Record<number, NewTable["fields"][number]["type"]> = { 1: "BOOLEAN", 2: "INTEGER", 3: "INTEGER", 4: "INTEGER", 5: "INTEGER", 6: "REAL", 14: "DATE", 16: "DATETIME" };

function fieldsOf(layer: QgsVectorLayer) {
  return Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i));
}

/** Iterates features (optionally only `fids`, optionally reprojected to `crs`). */
function* features(layer: QgsVectorLayer, fids?: number[], crs?: string) {
  const api = engine();
  const req = new api.QgsFeatureRequest();
  if (fids) req.setFilterFids(fids);
  if (crs && crs !== layer.crs()) req.setDestinationCrs(crs);
  const it = layer.getFeatures(req);
  try {
    for (let f = it.nextFeature(); f; f = it.nextFeature()) {
      yield f;
      free(f);
    }
  } finally {
    free(it);
    free(req);
  }
}

const plain = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

/** The layer as a GeoPackage table (in the layer's CRS). */
export async function layerToGpkg(layerId: string, fids?: number[]) {
  const api = engine();
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const fields = fieldsOf(layer).filter((f) => f.name().toLowerCase() !== "fid");
  const rows = [];
  let geomType = "GEOMETRY";
  for (const f of features(layer, fids)) {
    const g = f.hasGeometry() ? f.geometry() : null;
    if (g && geomType === "GEOMETRY") geomType = api.QgsWkbTypes.displayString(api.QgsWkbTypes.flatType(g.wkbType())).toUpperCase();
    rows.push({ geometry: g ? g.asWkb() : null, attributes: fields.map((fd) => plain(f.attribute(fd.name()))) });
  }
  const [org, code] = (layer.crs() || "EPSG:4326").split(":");
  const table = layer.name.replace(/[^\w]+/g, "_") || "layer";
  const bytes = await writeGpkgTable(null, {
    name: table,
    geometryType: geomType,
    srs: { organization: org, code: Number(code), definition: "undefined" },
    fields: fields.map((f) => ({ name: f.name(), type: SQL_TYPES[f.type()] ?? "TEXT" })),
    features: rows,
  });
  return { bytes, table };
}

/** GeoJSON in WGS 84 (RFC 7946). */
export function layerToGeoJson(layerId: string, fids?: number[]) {
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const names = fieldsOf(layer).map((f) => f.name());
  const out = [];
  for (const f of features(layer, fids, "EPSG:4326")) {
    const attrs = f.attributes();
    out.push({ type: "Feature", id: f.id(), geometry: f.hasGeometry() ? JSON.parse(f.geometry().asJson(7)) : null, properties: Object.fromEntries(names.map((n, i) => [n, plain(attrs[i])])) });
  }
  return JSON.stringify({ type: "FeatureCollection", name: layer.name, features: out });
}

/** CSV with a WKT geometry column (in the layer's CRS). */
export function layerToCsv(layerId: string, fids?: number[]) {
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const names = fieldsOf(layer).map((f) => f.name());
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(plain(v));
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [[...names, "wkt"].map(cell).join(",")];
  for (const f of features(layer, fids)) lines.push([...f.attributes(), f.hasGeometry() ? f.geometry().asWkt(8) : ""].map(cell).join(","));
  return lines.join("\r\n");
}

export type ExportFormat = "gpkg" | "geojson" | "csv";

export async function exportLayer(layerId: string, format: ExportFormat, fids?: number[]) {
  const name = (findMapLayer(layerId)?.name ?? "layer").replace(/[\\/:*?"<>|]+/g, "_");
  const data = format === "gpkg" ? (await layerToGpkg(layerId, fids)).bytes : format === "geojson" ? layerToGeoJson(layerId, fids) : layerToCsv(layerId, fids);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart]));
  a.download = `${name}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
