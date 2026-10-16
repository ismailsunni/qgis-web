import { strFromU8 } from "fflate";
import { insertLayerXml, layerSource, mapLayerEl, newLayerId, project, findChild } from "./doc";
import { crsByAuthid, spatialRefSys, type CrsDef } from "./crs";
import { writeFile } from "./engine";
import { apply } from "./commit";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";

/**
 * Remote layers are stored as regular QGIS layers (so Desktop opens them) but read by the browser:
 * tiles and images are drawn by OpenLayers, remote vector files and WFS are downloaded and drawn by
 * QGIS. The engine has no network access yet (QEP #294).
 */
export type RemoteKind = "xyz" | "wms" | "wmts" | "cog" | "file" | "wfs" | "vectortile" | "pmtiles" | "oapif" | "arcgisfeature" | "arcgismap" | "mbtiles";

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
  /** PMTiles archives of raster tiles (rather than vector tiles). */
  raster?: boolean;
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
      return { type: "vector-tile", provider: "vectortile", ds: `${arcgisTiles(s.url) ? "serviceType=arcgis&" : ""}type=xyz&url=${uriValue(s.url)}&zmax=${s.zmax ?? 14}&zmin=${s.zmin ?? 0}` };
    case "cog":
      return { type: "raster", provider: "gdal", ds: `/vsicurl/${s.url}` };
    case "file":
      return { type: "vector", provider: "ogr", ds: `/vsicurl/${s.url}` };
    case "wfs":
      return { type: "vector", provider: "WFS", ds: `pagingEnabled='true' preferCoordinatesForWfsT11='false' restrictToRequestBBOX='0' srsname='EPSG:4326' typename='${s.layer}' url='${s.url}' version='auto'` };
    case "oapif":
      return { type: "vector", provider: "OAPIF", ds: `pagingEnabled='true' preferCoordinatesForWfsT11='false' restrictToRequestBBOX='0' typename='${s.layer}' url='${s.url}'` };
    case "arcgisfeature":
      return { type: "vector", provider: "arcgisfeatureserver", ds: `url='${s.url}'` };
    case "arcgismap":
      return { type: "raster", provider: "arcgismapserver", ds: `format='${s.format ?? "png32"}' layer='${s.layer ?? "0"}' url='${s.url}'` };
    case "mbtiles":
      return s.raster ? { type: "raster", provider: "gdal", ds: s.url } : { type: "vector-tile", provider: "vectortile", ds: `type=mbtiles&url=${s.url}` };
    case "pmtiles":
      // As QGIS Desktop opens PMTiles: through GDAL, a raster, or one vector layer per source layer.
      return s.raster ? { type: "raster", provider: "gdal", ds: `/vsicurl/${s.url}` } : { type: "vector", provider: "ogr", ds: `/vsicurl/${s.url}|layername=${s.layer}` };
  }
}

/** ArcGIS VectorTileServer URLs (QGIS's "arcgis" vector tile service type). */
export const arcgisTiles = (url: string) => /\/VectorTileServer\/?$/i.test(url);

/** Tile templates offered by an OGC API Tiles tileset (or a collection's WebMercatorQuad tilesets). */
export async function ogcTilesets(url: string) {
  const base = url.replace(/\?.*$/, "").replace(/\/$/, "");
  const candidates = /\/tiles\/[^/]+$/.test(base) ? [base] : [`${base}/map/tiles/WebMercatorQuad`, `${base}/tiles/WebMercatorQuad`];
  const out: { name: string; title: string }[] = [];
  for (const c of candidates) {
    const r = await fetch(`${c}?f=json`, { headers: { Accept: "application/json" } }).catch(() => null);
    if (!r?.ok) continue;
    for (const l of (await r.json()).links ?? []) {
      const kind = /^image\/(png|jpeg)/.test(l.type) ? t("Map tiles") : l.type === "application/vnd.mapbox-vector-tile" ? t("Vector tiles") : null;
      if (l.rel === "item" && kind) {
        const template = new URL(l.href, r.url).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
        out.push({ name: template.replace("{tileMatrix}", "{z}").replace("{tileRow}", "{y}").replace("{tileCol}", "{x}"), title: `${kind} (${l.type})` });
      }
    }
  }
  return out;
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
  if (p === "vectortile" && datasource.includes("type=mbtiles")) return { kind: "mbtiles", name, url: params(datasource).url };
  if (p === "gdal" && /\.mbtiles$/i.test(datasource)) return { kind: "mbtiles", name, url: datasource, raster: true };
  if (p === "vectortile") {
    const q = datasource.includes("url=") && !datasource.includes("'") ? params(datasource) : quoted(datasource);
    return { kind: "vectortile", name, url: q.url, zmin: +q.zmin || 0, zmax: +q.zmax || 14 };
  }
  if (p === "oapif") {
    const q = quoted(datasource);
    return { kind: "oapif", name, url: q.url, layer: q.typename };
  }
  if (p === "arcgisfeatureserver") return { kind: "arcgisfeature", name, url: quoted(datasource).url };
  if (p === "arcgismapserver") {
    const q = quoted(datasource);
    return { kind: "arcgismap", name, url: q.url, layer: q.layer, format: q.format };
  }
  if (p === "wfs") {
    const q = quoted(datasource);
    return { kind: "wfs", name, url: q.url, layer: q.typename };
  }
  if (datasource.startsWith("/vsicurl/")) {
    const url = datasource.slice(9).split("|")[0];
    if (/\.pmtiles(\?|$)/i.test(url)) return p === "gdal" ? { kind: "pmtiles", name, url, raster: true } : { kind: "pmtiles", name, url, layer: datasource.match(/\|layername=([^|]+)/)?.[1] };
    return { kind: p === "gdal" ? "cog" : "file", name, url };
  }
  return null;
}

/** Kinds OpenLayers draws; the rest go through QGIS from a downloaded copy. */
export const drawnByBrowser = (s: RemoteSpec | null) => !!s && ["xyz", "wms", "wmts", "cog", "vectortile", "pmtiles", "arcgismap", "mbtiles"].includes(s.kind);

/** Kinds whose features are downloaded for QGIS to draw. */
const downloaded = (s: RemoteSpec | null) => !!s && ["file", "wfs", "oapif", "arcgisfeature"].includes(s.kind);

/** Reads every page of an OGC API Features collection or an ArcGIS feature layer as GeoJSON. */
async function fetchFeaturePages(s: RemoteSpec, limit = 100_000) {
  const features: unknown[] = [];
  if (s.kind === "oapif") {
    let next: string | null = `${s.url.replace(/\/$/, "")}/collections/${encodeURIComponent(s.layer!)}/items?f=json&limit=1000`;
    while (next && features.length < limit) {
      const r = await fetch(next, { headers: { Accept: "application/geo+json, application/json" } });
      if (!r.ok) throw new Error(`${s.name}: ${r.status} ${r.statusText}`);
      const page = await r.json();
      features.push(...(page.features ?? []));
      next = page.features?.length ? (page.links ?? []).find((l: { rel: string; type?: string }) => l.rel === "next" && (!l.type || /json/.test(l.type)))?.href ?? null : null;
    }
  } else {
    for (let offset = 0; features.length < limit; ) {
      const u = new URL(`${s.url.replace(/\/$/, "")}/query`);
      for (const [k, v] of Object.entries({ where: "1=1", outFields: "*", f: "geojson", outSR: "4326", resultOffset: String(offset), resultRecordCount: "2000" })) u.searchParams.set(k, v);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${s.name}: ${r.status} ${r.statusText}`);
      const page = await r.json();
      if (page.error) throw new Error(`${s.name}: ${page.error.message}`);
      features.push(...(page.features ?? []));
      offset += page.features?.length ?? 0;
      if (!page.features?.length || !(page.exceededTransferLimit || page.properties?.exceededTransferLimit)) break;
    }
  }
  return new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features }));
}

let cache = 0;

/** Downloads a remote vector source for the engine and points the layer at the local copy. */
async function hydrate(id: string, s: RemoteSpec) {
  let url = s.url;
  if (s.kind === "wfs") {
    const u = new URL(url);
    for (const [k, v] of Object.entries({ service: "WFS", request: "GetFeature", version: "2.0.0", typeNames: s.layer!, outputFormat: "application/json", srsName: "EPSG:4326" })) u.searchParams.set(k, v);
    url = u.href;
  }
  let bytes: Uint8Array;
  if (s.kind === "oapif" || s.kind === "arcgisfeature") bytes = await fetchFeaturePages(s);
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${s.name}: ${res.status} ${res.statusText}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const ext = s.kind === "file" ? new URL(s.url).pathname.split(".").pop() || "dat" : "geojson";
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
  const todo = ids.map((id) => [id, remoteSpec(id)] as const).filter(([, s]) => downloaded(s));
  if (!todo.length) return;
  const errors: string[] = [];
  await Promise.all(todo.map(([id, s]) => hydrate(id, s!).catch((e) => errors.push(e.message))));
  if (errors.length) toast(t("Could not load: {errors} (the server must allow CORS)", { errors: errors.join("; ") }));
}

async function detectCrs(s: RemoteSpec, bytes?: Uint8Array): Promise<CrsDef | null> {
  if (["xyz", "wms", "wmts", "vectortile", "pmtiles", "arcgismap"].includes(s.kind)) return crsByAuthid("EPSG:3857");
  if (["wfs", "oapif", "arcgisfeature"].includes(s.kind)) return crsByAuthid("EPSG:4326");
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

export async function addRemote(spec: RemoteSpec, where: "top" | "bottom" = "top") {
  let s = spec;
  if (ui.phase !== "ready") {
    const { newProject } = await import("./actions");
    await newProject();
  }
  const id = newLayerId(s.name);
  let bytes: Uint8Array | undefined;
  try {
    if (s.kind === "pmtiles") {
      // The archive header says whether it holds vector (MVT) or raster tiles.
      const { PMTiles, TileType } = await import("pmtiles");
      const archive = new PMTiles(s.url);
      s = { ...s, raster: (await archive.getHeader()).tileType !== TileType.Mvt };
      if (!s.raster && !s.layer) return addPmtilesGroup(s, archive);
    }
    if (downloaded(s)) {
      project().local[id] = { datasource: "", provider: "ogr" };
      bytes = await hydrate(id, s);
    }
    const { type, provider, ds } = datasourceFor(s);
    const crs = await detectCrs(s, bytes).catch(() => null);
    const srs = crs ? `<srs>${spatialRefSys(crs)}</srs>` : "";
    apply(() => {
      insertLayerXml(`<maplayer type="${type}"><id>${id}</id><datasource>${esc(ds)}</datasource><layername>${esc(s.name)}</layername>${srs}<provider encoding="UTF-8">${provider}</provider></maplayer>`, s.name);
      // Basemaps go under everything else.
      if (where === "bottom") {
        const node = project().xml.querySelector(`layer-tree-layer[id="${CSS.escape(id)}"]`)!;
        node.parentElement!.appendChild(node);
      }
    }, `add ${s.name}`);
    ui.current = id;
  } catch (e) {
    delete project().local[id];
    toast(t("Could not add {name}: {error}. The server must allow cross-origin requests (CORS).", { name: s.name, error: (e as Error).message }));
  }
}

/** A vector PMTiles archive becomes a group with one layer per source layer, as Desktop opens it. */
async function addPmtilesGroup(s: RemoteSpec, archive: import("pmtiles").PMTiles) {
  const meta = (await archive.getMetadata()) as { vector_layers?: { id: string }[] };
  const sources = (meta.vector_layers ?? []).map((l) => l.id);
  if (!sources.length) return toast(t("{name}: no vector layers found in the archive.", { name: s.name }));
  const crs = await crsByAuthid("EPSG:3857");
  const srs = crs ? `<srs>${spatialRefSys(crs)}</srs>` : "";
  apply(() => {
    const xml = project().xml;
    const group = xml.createElement("layer-tree-group");
    for (const [k, v] of Object.entries({ name: s.name, checked: "Qt::Checked", expanded: "1" })) group.setAttribute(k, v);
    const root = xml.querySelector("qgis > layer-tree-group")!;
    root.insertBefore(group, [...root.children].find((c) => c.tagName.startsWith("layer-tree")) ?? null);
    for (const layer of [...sources].reverse()) {
      const { ds } = datasourceFor({ ...s, layer, raster: false });
      insertLayerXml(`<maplayer type="vector"><id>${newLayerId(layer)}</id><datasource>${esc(ds)}</datasource><layername>${esc(layer)}</layername>${srs}<provider encoding="UTF-8">ogr</provider></maplayer>`, layer, group);
    }
  }, `add ${s.name}`);
}

/** Basemaps that allow cross-origin use (needed to draw and export them). */
export const PRESETS: RemoteSpec[] = [
  { kind: "xyz", name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", zmax: 19 },
  { kind: "xyz", name: "OSM Humanitarian", url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", zmax: 19 },
  { kind: "xyz", name: "CyclOSM", url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", zmax: 19 },
  { kind: "xyz", name: "Esri Street Map", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", zmax: 19 },
  { kind: "xyz", name: "Esri Dark Gray", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", zmax: 16 },
  { kind: "xyz", name: "OpenTopoMap", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png", zmax: 17 },
  { kind: "xyz", name: "Esri World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", zmax: 19 },
  { kind: "xyz", name: "Esri World Topo", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", zmax: 19 },
  { kind: "xyz", name: "Esri Light Gray", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", zmax: 16 },
];

/** Required credits per tile host, shown on the map and in exports. */
export function attributionFor(url: string) {
  const host = (() => {
    try {
      return new URL(url.replace(/[{}]/g, "")).hostname;
    } catch {
      return "";
    }
  })();
  if (host.endsWith("openstreetmap.org")) return "© OpenStreetMap contributors";
  if (host.endsWith("tile.openstreetmap.fr")) return "© OpenStreetMap contributors, tiles OSM France";
  if (host.endsWith("tile-cyclosm.openstreetmap.fr")) return "© OpenStreetMap contributors, CyclOSM, tiles OSM France";
  if (host.endsWith("opentopomap.org")) return "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)";
  if (host.endsWith("arcgisonline.com") || host.endsWith("arcgis.com")) return "Powered by Esri";
  return "";
}

/** A tile of the template at z/x/y, for previews. */
export const tileUrl = (template: string, z = 2, x = 2, y = 1) => template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{-y}", String(2 ** z - 1 - y));

