import { strFromU8 } from "fflate";
import { insertLayerXml, layerSource, mapLayerEl, newLayerId, project, findChild } from "./doc";
import { crsByAuthid, spatialRefSys, type CrsDef } from "./crs";
import { writeFile } from "./engine";
import { apply } from "./commit";
import { ui, toast } from "./state.svelte";

/**
 * Remote layers are stored as regular QGIS layers (so Desktop opens them) but read by the browser:
 * tiles and images are drawn by OpenLayers, remote vector files and WFS are downloaded and drawn by
 * QGIS. The engine has no network access yet (QEP #294).
 */
export type RemoteKind = "xyz" | "wms" | "wmts" | "cog" | "file" | "wfs" | "vectortile";

export interface RemoteSpec {
  kind: RemoteKind;
  name: string;
  url: string;
  layer?: string;
  style?: string;
  format?: string;
  matrixSet?: string;
  zmin?: number;
  zmax?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Values in QGIS data source URIs are percent-encoded where they would break the key=value&… syntax. */
const uriValue = (s: string) => s.replace(/%/g, "%25").replace(/&/g, "%26").replace(/=/g, "%3D").replace(/\{/g, "%7B").replace(/\}/g, "%7D");
const fromUri = (s: string) => decodeURIComponent(s);

function params(datasource: string) {
  const out: Record<string, string> = {};
  for (const part of datasource.split("&")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = fromUri(part.slice(i + 1));
  }
  return out;
}

/** Parses QGIS's quoted key='value' URIs (WFS, vector tiles…). */
function quoted(datasource: string) {
  const out: Record<string, string> = {};
  for (const [, k, v] of datasource.matchAll(/(\w+)='((?:[^'\\]|\\.)*)'/g)) out[k] = v.replace(/\\'/g, "'");
  return out;
}

export function datasourceFor(s: RemoteSpec) {
  switch (s.kind) {
    case "xyz":
      return { type: "raster", provider: "wms", ds: `type=xyz&url=${uriValue(s.url)}&zmax=${s.zmax ?? 19}&zmin=${s.zmin ?? 0}` };
    case "wms":
      return { type: "raster", provider: "wms", ds: `contextualWMSLegend=0&crs=EPSG:3857&dpiMode=7&featureCount=10&format=${s.format ?? "image/png"}&layers=${uriValue(s.layer ?? "")}&styles=${uriValue(s.style ?? "")}&url=${uriValue(s.url)}` };
    case "wmts":
      return { type: "raster", provider: "wms", ds: `contextualWMSLegend=0&crs=EPSG:3857&dpiMode=7&featureCount=10&format=${s.format ?? "image/png"}&layers=${uriValue(s.layer ?? "")}&styles=${uriValue(s.style ?? "default")}&tileMatrixSet=${uriValue(s.matrixSet ?? "")}&url=${uriValue(s.url)}` };
    case "vectortile":
      return { type: "vector-tile", provider: "vectortile", ds: `type=xyz&url=${uriValue(s.url)}&zmax=${s.zmax ?? 14}&zmin=${s.zmin ?? 0}` };
    case "cog":
      return { type: "raster", provider: "gdal", ds: `/vsicurl/${s.url}` };
    case "file":
      return { type: "vector", provider: "ogr", ds: `/vsicurl/${s.url}` };
    case "wfs":
      return { type: "vector", provider: "WFS", ds: `pagingEnabled='true' preferCoordinatesForWfsT11='false' restrictToRequestBBOX='0' srsname='EPSG:4326' typename='${s.layer}' url='${s.url}' version='auto'` };
  }
}

/** Reads a remote layer's spec back from its QGIS data source. */
export function remoteSpec(id: string): RemoteSpec | null {
  const { provider, datasource } = layerSource(id);
  const name = findChild(mapLayerEl(id)!, "layername")?.textContent ?? "";
  const p = provider.toLowerCase();
  if (p === "wms") {
    const q = params(datasource);
    if (q.type === "xyz") return { kind: "xyz", name, url: q.url, zmin: +q.zmin || 0, zmax: +q.zmax || 19 };
    if (q.tileMatrixSet) return { kind: "wmts", name, url: q.url, layer: q.layers, style: q.styles, format: q.format, matrixSet: q.tileMatrixSet };
    return { kind: "wms", name, url: q.url, layer: q.layers, style: q.styles, format: q.format };
  }
  if (p === "vectortile") {
    const q = datasource.includes("url=") && !datasource.includes("'") ? params(datasource) : quoted(datasource);
    return { kind: "vectortile", name, url: q.url, zmin: +q.zmin || 0, zmax: +q.zmax || 14 };
  }
  if (p === "wfs") {
    const q = quoted(datasource);
    return { kind: "wfs", name, url: q.url, layer: q.typename };
  }
  if (datasource.startsWith("/vsicurl/")) return { kind: p === "gdal" ? "cog" : "file", name, url: datasource.slice(9).split("|")[0] };
  return null;
}

/** Kinds OpenLayers draws; the rest go through QGIS from a downloaded copy. */
export const drawnByBrowser = (s: RemoteSpec | null) => !!s && ["xyz", "wms", "wmts", "cog", "vectortile"].includes(s.kind);

let cache = 0;

/** Downloads a remote vector source for the engine and points the layer at the local copy. */
async function hydrate(id: string, s: RemoteSpec) {
  let url = s.url;
  if (s.kind === "wfs") {
    const u = new URL(url);
    for (const [k, v] of Object.entries({ service: "WFS", request: "GetFeature", version: "2.0.0", typeNames: s.layer!, outputFormat: "application/json", srsName: "EPSG:4326" })) u.searchParams.set(k, v);
    url = u.href;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${s.name}: ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = s.kind === "wfs" ? "geojson" : new URL(s.url).pathname.split(".").pop() || "dat";
  const path = `/remote-cache/${++cache}/${s.name.replace(/\W/g, "_") || "layer"}.${ext}`;
  writeFile(path, bytes);
  const layer = s.kind === "file" && layerSource(id).datasource.includes("|") ? "|" + layerSource(id).datasource.split("|").slice(1).join("|") : "";
  project().local[id] = { datasource: path + layer, provider: "ogr" };
  return bytes;
}

/**
 * Downloads every remote vector layer of the project. Done before QGIS first loads the project:
 * a layer that is missing on the first load and appears on a later one gets dropped by QGIS.
 */
export async function hydrateAll() {
  const ids = [...project().xml.querySelectorAll("projectlayers > maplayer > id")].map((e) => e.textContent!);
  const todo = ids.map((id) => [id, remoteSpec(id)] as const).filter(([, s]) => s && (s.kind === "file" || s.kind === "wfs"));
  if (!todo.length) return;
  const errors: string[] = [];
  await Promise.all(todo.map(([id, s]) => hydrate(id, s!).catch((e) => errors.push(e.message))));
  if (errors.length) toast(`Could not load: ${errors.join("; ")} (the server must allow CORS)`);
}

async function detectCrs(s: RemoteSpec, bytes?: Uint8Array): Promise<CrsDef | null> {
  if (["xyz", "wms", "wmts", "vectortile"].includes(s.kind)) return crsByAuthid("EPSG:3857");
  if (s.kind === "wfs") return crsByAuthid("EPSG:4326");
  if (s.kind === "cog") {
    const { fromUrl } = await import("geotiff");
    const keys = (await (await fromUrl(s.url)).getImage()).getGeoKeys() as Record<string, number> | null;
    const code = keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey;
    return code && code !== 32767 ? crsByAuthid(`EPSG:${code}`) : null;
  }
  if (bytes && /\.(geo)?json$/i.test(s.url)) {
    const name = JSON.parse(strFromU8(bytes))?.crs?.properties?.name;
    return crsByAuthid(name ? name.replace(/^urn:ogc:def:crs:/i, "").replace(/::?/, ":") : "EPSG:4326");
  }
  return null;
}

export async function addRemote(s: RemoteSpec) {
  if (ui.phase !== "ready") {
    const { newProject } = await import("./actions");
    await newProject();
  }
  const { type, provider, ds } = datasourceFor(s);
  const id = newLayerId(s.name);
  let bytes: Uint8Array | undefined;
  try {
    if (s.kind === "file" || s.kind === "wfs") {
      project().local[id] = { datasource: "", provider: "ogr" };
      bytes = await hydrate(id, s);
    }
    const crs = await detectCrs(s, bytes).catch(() => null);
    const srs = crs ? `<srs>${spatialRefSys(crs)}</srs>` : "";
    apply(() => insertLayerXml(`<maplayer type="${type}"><id>${id}</id><datasource>${esc(ds)}</datasource><layername>${esc(s.name)}</layername>${srs}<provider encoding="UTF-8">${provider}</provider></maplayer>`, s.name));
    ui.current = id;
  } catch (e) {
    delete project().local[id];
    toast(`Could not add ${s.name}: ${(e as Error).message}. The server must allow cross-origin requests (CORS).`);
  }
}

export const PRESETS: RemoteSpec[] = [
  { kind: "xyz", name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", zmax: 19 },
  { kind: "xyz", name: "Esri World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", zmax: 19 },
  { kind: "xyz", name: "OpenTopoMap", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png", zmax: 17 },
];
