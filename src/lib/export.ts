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

/** Features as a GeoJSON object (WGS 84 unless another CRS is asked for). */
function featureCollection(layerId: string, fids?: number[], crs = "EPSG:4326") {
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const names = fieldsOf(layer).map((f) => f.name());
  const out = [];
  for (const f of features(layer, fids, crs)) {
    const attrs = f.attributes();
    out.push({ type: "Feature" as const, id: f.id(), geometry: f.hasGeometry() ? JSON.parse(f.geometry().asJson(crs === "EPSG:4326" ? 7 : 10)) : null, properties: Object.fromEntries(names.map((n, i) => [n, plain(attrs[i])])) });
  }
  return { type: "FeatureCollection" as const, name: layer.name, features: out };
}

/** GeoJSON in WGS 84 (RFC 7946). */
export const layerToGeoJson = (layerId: string, fids?: number[]) => JSON.stringify(featureCollection(layerId, fids));

/** FlatGeobuf in the layer's CRS (with a spatial index). */
export async function layerToFlatGeobuf(layerId: string, fids?: number[]) {
  const { serialize } = await import("flatgeobuf/geojson");
  const crs = (findMapLayer(layerId) as QgsVectorLayer).crs();
  const code = /^EPSG:\d+$/.test(crs) ? Number(crs.slice(5)) : 4326;
  return serialize(featureCollection(layerId, fids, code === 4326 ? "EPSG:4326" : crs) as never, code);
}

/** A zipped Shapefile in WGS 84 (one .shp per geometry type, as the format requires). */
export async function layerToShapefile(layerId: string, fids?: number[]) {
  const { zip } = await import("@mapbox/shp-write");
  const name = (findMapLayer(layerId)?.name ?? "layer").replace(/[^\w-]+/g, "_");
  const fc = featureCollection(layerId, fids);
  // Shapefile field names are limited to 10 characters and can't hold nested values.
  for (const f of fc.features) for (const [k, v] of Object.entries(f.properties)) if (v !== null && typeof v === "object") f.properties[k] = JSON.stringify(v);
  const data = await zip(fc as never, { outputType: "uint8array", compression: "DEFLATE", types: { point: `${name}_points`, polygon: `${name}_polygons`, polyline: `${name}_lines` } } as never);
  return data as unknown as Uint8Array;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** KML in WGS 84, attributes as ExtendedData. */
export function layerToKml(layerId: string, fids?: number[]) {
  const fc = featureCollection(layerId, fids);
  const coords = (c: number[][]) => c.map((p) => p.slice(0, 2).join(",")).join(" ");
  const ring = (r: number[][]) => `<LinearRing><coordinates>${coords(r)}</coordinates></LinearRing>`;
  const polygon = (p: number[][][]) => `<Polygon><outerBoundaryIs>${ring(p[0])}</outerBoundaryIs>${p.slice(1).map((h) => `<innerBoundaryIs>${ring(h)}</innerBoundaryIs>`).join("")}</Polygon>`;
  const geom = (g: { type: string; coordinates: never; geometries?: never[] } | null): string => {
    if (!g) return "";
    switch (g.type) {
      case "Point": return `<Point><coordinates>${(g.coordinates as number[]).slice(0, 2).join(",")}</coordinates></Point>`;
      case "LineString": return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
      case "Polygon": return polygon(g.coordinates);
      case "MultiPoint": return `<MultiGeometry>${(g.coordinates as number[][]).map((c) => `<Point><coordinates>${c.slice(0, 2).join(",")}</coordinates></Point>`).join("")}</MultiGeometry>`;
      case "MultiLineString": return `<MultiGeometry>${(g.coordinates as number[][][]).map((c) => `<LineString><coordinates>${coords(c)}</coordinates></LineString>`).join("")}</MultiGeometry>`;
      case "MultiPolygon": return `<MultiGeometry>${(g.coordinates as number[][][][]).map(polygon).join("")}</MultiGeometry>`;
      default: return `<MultiGeometry>${(g.geometries ?? []).map(geom).join("")}</MultiGeometry>`;
    }
  };
  const placemarks = fc.features.map((f) => {
    const props = Object.entries(f.properties);
    const title = props.find(([k]) => /^name$/i.test(k))?.[1] ?? f.id;
    return `<Placemark><name>${esc(String(title))}</name><ExtendedData>${props.map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v === null ? "" : String(v))}</value></Data>`).join("")}</ExtendedData>${geom(f.geometry)}</Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(fc.name)}</name>${placemarks.join("\n")}</Document></kml>`;
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

export type ExportFormat = "gpkg" | "geojson" | "csv" | "fgb" | "shp" | "kml";

const WRITERS: Record<ExportFormat, [string, (id: string, fids?: number[]) => Promise<BlobPart> | BlobPart]> = {
  gpkg: ["gpkg", async (id, fids) => (await layerToGpkg(id, fids)).bytes as BlobPart],
  geojson: ["geojson", layerToGeoJson],
  csv: ["csv", layerToCsv],
  fgb: ["fgb", (id, fids) => layerToFlatGeobuf(id, fids) as Promise<BlobPart>],
  shp: ["zip", (id, fids) => layerToShapefile(id, fids) as Promise<BlobPart>],
  kml: ["kml", layerToKml],
};

export async function exportLayer(layerId: string, format: ExportFormat, fids?: number[]) {
  const name = (findMapLayer(layerId)?.name ?? "layer").replace(/[\\/:*?"<>|]+/g, "_");
  const [ext, write] = WRITERS[format];
  const data = await write(layerId, fids);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = `${name}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
