import { addRemote } from "./remote";
import { addData } from "./adddata";

/**
 * Open data catalogs searched from the browser: STAC APIs for imagery and elevation (added as
 * cloud-optimized GeoTIFFs) and CKAN portals for vector data (government and humanitarian data).
 */

export const STAC_APIS = [{ name: "Earth Search (AWS open data)", url: "https://earth-search.aws.element84.com/v1" }];

/** Collections worth offering by default, with the asset to show. */
export const STAC_PRESETS: { id: string; title: string; asset: string; cloud?: boolean }[] = [
  { id: "sentinel-2-l2a", title: "Sentinel-2 true color (10 m, worldwide, every few days)", asset: "visual", cloud: true },
  { id: "cop-dem-glo-30", title: "Copernicus DEM elevation (30 m, worldwide)", asset: "data" },
  { id: "naip", title: "NAIP aerial imagery (USA, 0.6–1 m)", asset: "image" },
];

export interface StacItem { id: string; collection: string; datetime: string; cloud: number | null; thumbnail: string | null; href: string; geometry: object }

const COG = /cloud-optimized|image\/tiff/i;

/** Items of a collection over an area (lon/lat bbox), newest first. */
export async function stacSearch(api: string, collection: string, bbox: number[], o: { from?: string; to?: string; maxCloud?: number; asset?: string } = {}): Promise<StacItem[]> {
  const body: Record<string, unknown> = { collections: [collection], bbox, limit: 30, sortby: [{ field: "properties.datetime", direction: "desc" }] };
  if (o.from || o.to) body.datetime = `${o.from ? `${o.from}T00:00:00Z` : ".."}/${o.to ? `${o.to}T23:59:59Z` : ".."}`;
  if (o.maxCloud !== undefined) body.query = { "eo:cloud_cover": { lt: o.maxCloud } };
  let r = await fetch(`${api}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // Not every API has sorting and queries: retry with the core of the search.
  if (!r.ok) r = await fetch(`${api}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collections: [collection], bbox, limit: 30, datetime: body.datetime }) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const features = (await r.json()).features ?? [];
  return features.flatMap((f: any): StacItem[] => {
    const assets = f.assets ?? {};
    const key = o.asset && assets[o.asset] ? o.asset : Object.keys(assets).find((k) => COG.test(assets[k].type ?? ""));
    if (!key) return [];
    return [{ id: f.id, collection, datetime: f.properties?.datetime ?? f.properties?.start_datetime ?? "", cloud: f.properties?.["eo:cloud_cover"] ?? null, thumbnail: assets.thumbnail?.href ?? null, href: assets[key].href, geometry: f.geometry }];
  });
}

export const stacCollections = async (api: string) =>
  ((await (await fetch(`${api}/collections`)).json()).collections ?? []).map((c: any) => ({ id: c.id as string, title: (c.title || c.id) as string }));

export const addStacItem = (item: StacItem) => addRemote({ kind: "cog", name: `${item.collection} ${item.datetime.slice(0, 10)}`, url: item.href });

// ---- CKAN portals ------------------------------------------------------------------------------

// Portals whose search allows browsers; whether each file can be read depends on its own server.
export const PORTALS = [
  { name: "data.gov.au", url: "https://data.gov.au/data" },
  { name: "data.gov.uk", url: "https://ckan.publishing.service.gov.uk" },
  { name: "Open Government Canada", url: "https://open.canada.ca/data" },
  { name: "Humanitarian Data Exchange (HDX)", url: "https://data.humdata.org" },
];

export interface Resource { name: string; format: string; url: string }
export interface Dataset { title: string; org: string; page: string; resources: Resource[] }

const GEO = /^(geo\s?json|json|kml|kmz|shp|shapefile|esri shapefile|zip|gpkg|geopackage|csv|fgb|flatgeobuf|tiff?|geotiff|wms|wfs|esri rest|arcgis geoservices)/i;

export async function portalSearch(portal: string, q: string): Promise<Dataset[]> {
  const r = await fetch(`${portal}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=25`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return ((await r.json()).result?.results ?? []).flatMap((d: any): Dataset[] => {
    const resources = (d.resources ?? []).filter((x: any) => x.url && (GEO.test(x.format ?? "") || /\.(geojson|kml|kmz|gpkg|fgb|shp|zip|tif|tiff)(\?|$)/i.test(x.url)));
    return resources.length ? [{ title: d.title ?? d.name, org: d.organization?.title ?? "", page: `${portal}/dataset/${d.name}`, resources: resources.map((x: any) => ({ name: x.name || x.url.split("/").pop(), format: (x.format || "").toUpperCase(), url: x.url })) }] : [];
  });
}

/** How a resource is added: a web service (needs its layer chosen), a linked file, or a download. */
export function resourceKind(r: Resource): "wms" | "wfs" | "arcgis" | "cog" | "linked" | "download" {
  const f = `${r.format} ${r.url}`.toLowerCase();
  if (/\bwms\b|service=wms/.test(f)) return "wms";
  if (/\bwfs\b|service=wfs/.test(f)) return "wfs";
  if (/arcgis|esri rest|\/(map|feature)server/.test(f)) return "arcgis";
  if (/\.tiff?(\?|$)|geotiff|\btiff?\b/.test(f)) return "cog";
  if (!/\.zip(\?|$)|\bzip\b/.test(f) && /geojson|\.json|flatgeobuf|\.fgb|\bkml\b|\.kml|gpkg|geopackage/.test(f)) return "linked";
  return "download";
}

/** Adds a file resource: linked to its URL where QGIS can read it, else downloaded into the project. */
export async function addResource(r: Resource) {
  const kind = resourceKind(r);
  // Linked layers are read from their server later on: check now that it lets the browser in.
  if (kind === "cog" || kind === "linked") {
    const probe = await fetch(r.url, { headers: { Range: "bytes=0-0" } });
    if (!probe.ok) throw new Error(`${probe.status} ${probe.statusText}`);
    await probe.body?.cancel();
  }
  if (kind === "cog") return addRemote({ kind: "cog", name: r.name, url: r.url });
  if (kind === "linked") return addRemote({ kind: "file", name: r.name.replace(/\.[^.]+$/, ""), url: r.url });
  const res = await fetch(r.url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || r.name);
  const ext = /\.\w+$/.test(name) ? "" : `.${(r.format || "zip").toLowerCase().replace(/\s.*/, "")}`;
  return addData([{ path: name + ext, data: new Uint8Array(await res.arrayBuffer()) }]);
}
