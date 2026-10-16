import { findChild, layerSource, project, serialize } from "./doc";
import { exists, readFile } from "./engine";
import { remoteSpec, type RemoteSpec } from "./remote";
import { cleanDatasource, stripSecrets } from "./secrets";
import { t } from "./i18n";

export { stripSecrets };

/**
 * Publishing a project for sharing (M5). Only the project file is published; every layer must read
 * from a remote source, so no user data is ever hosted. Projects are stored as GitHub gists:
 * secret gists are unlisted links, gist revisions are the version history.
 */

export interface LayerCheck { id: string; name: string; problem: "local" | "cors" | "credentials" | null; detail: string }

const layerName = (el: Element) => findChild(el, "layername")?.textContent ?? findChild(el, "id")?.textContent ?? "";

/** F17: layers that can't be published because their data is local. */
export function localLayers(): LayerCheck[] {
  const out: LayerCheck[] = [];
  for (const el of project().xml.querySelectorAll("projectlayers > maplayer")) {
    const id = findChild(el, "id")!.textContent!;
    if (remoteSpec(id) && remoteSpec(id)!.kind !== "mbtiles") continue;
    const { provider, datasource } = layerSource(id);
    const detail = provider === "memory" ? t("uses a temporary (memory) layer") : /\.gpkg/i.test(datasource) ? t("uses a local GeoPackage") : t("uses a local file ({file})", { file: datasource.split("|")[0] });
    out.push({ id, name: layerName(el), problem: "local", detail });
  }
  return out;
}


/** A URL the browser can request to test that a remote source allows cross-origin access. */
function probeUrl(s: RemoteSpec) {
  const tile = (u: string) => u.replace("{z}", "0").replace("{x}", "0").replace(/\{-?y\}/, "0");
  switch (s.kind) {
    case "xyz":
    case "vectortile":
      return tile(s.url);
    case "wms":
    case "wfs": {
      const u = new URL(s.url);
      u.searchParams.set("service", s.kind.toUpperCase());
      u.searchParams.set("request", "GetCapabilities");
      return u.href;
    }
    default:
      return s.url;
  }
}

/** F18: remote layers that block cross-origin requests or need credentials. */
export async function remoteProblems(): Promise<LayerCheck[]> {
  const els = [...project().xml.querySelectorAll("projectlayers > maplayer")];
  const checks = await Promise.all(
    els.map(async (el): Promise<LayerCheck | null> => {
      const id = findChild(el, "id")!.textContent!;
      const spec = remoteSpec(id);
      if (!spec || spec.kind === "mbtiles") return null;
      const name = layerName(el);
      const ds = layerSource(id).datasource;
      if (cleanDatasource(ds) !== ds) return { id, name, problem: "credentials", detail: t("needs credentials, which are removed when publishing") };
      try {
        const r = await fetch(probeUrl(spec), { method: spec.kind === "cog" || spec.kind === "file" ? "HEAD" : "GET", mode: "cors" });
        if (!r.ok && r.status !== 404) return { id, name, problem: "cors", detail: t("the server answered {status}", { status: r.status }) };
        return null;
      } catch {
        return { id, name, problem: "cors", detail: t("the server blocks cross-origin requests (no CORS), viewers will see an error") };
      }
    }),
  );
  return checks.filter((c): c is LayerCheck => !!c);
}

const PATH_OPTIONS = ["name", "svgFile", "imageFile", "shapeSVGFile"];

/** F20: embeds local SVG markers and images (as base64) so the project renders without local files. */
export function embedResources(xml: XMLDocument) {
  const d = project();
  let embedded = 0;
  const missing: string[] = [];
  const encode = (path: string) => {
    if (!path || /^(base64:|https?:|data:)/.test(path)) return null;
    const abs = path.startsWith("/") ? path : `${d.dir}/${path.replace(/^\.\//, "")}`;
    if (!exists(abs)) return path.includes("/") || path.includes(".") ? (missing.push(path), null) : null;
    const bytes = readFile(abs);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    embedded++;
    return "base64:" + btoa(bin);
  };
  for (const layer of xml.querySelectorAll('layer[class*="Svg"], layer[class*="SVG"], layer[class*="Raster"], text-style background')) {
    for (const o of layer.querySelectorAll(":scope > Option > Option, :scope > prop")) {
      const key = o.getAttribute("name") ?? o.getAttribute("k");
      if (!key || !PATH_OPTIONS.includes(key)) continue;
      const attr = o.hasAttribute("value") ? "value" : "v";
      const v = encode(o.getAttribute(attr) ?? "");
      if (v) o.setAttribute(attr, v);
    }
    if (layer.hasAttribute("shapeSVGFile")) {
      const v = encode(layer.getAttribute("shapeSVGFile")!);
      if (v) layer.setAttribute("shapeSVGFile", v);
    }
  }
  return { embedded, missing: [...new Set(missing)].filter((m) => !/^[\w-]+\/[\w-]+\.svg$/.test(m)) };
}

/** The project file to publish: secrets stripped, resources embedded. */
export function publishableProject() {
  const xml = project().xml.cloneNode(true) as XMLDocument;
  stripSecrets(xml);
  const resources = embedResources(xml);
  return { qgs: serialize(xml), resources };
}

// ---- GitHub gist storage --------------------------------------------------------------------

export interface PublishMeta {
  name: string;
  mode: "compact" | "maponly";
  /** F22: domains allowed to embed the map (empty: any). */
  allowedDomains: string[];
  publishedAt: string;
}

export interface Published { id: string; owner: string; public: boolean; url: string }

/** The gist a project was published to, kept in the project's own custom properties (Desktop preserves them). */
export function publishedRef(): { owner: string; id: string; public: boolean } | null {
  const el = project().xml.querySelector("qgis > properties > QGISWeb > published");
  return el ? JSON.parse(el.textContent ?? "null") : null;
}

export function setPublishedRef(ref: { owner: string; id: string; public: boolean }) {
  const xml = project().xml;
  let props = xml.querySelector("qgis > properties");
  if (!props) props = xml.documentElement.appendChild(xml.createElement("properties"));
  let group = props.querySelector(":scope > QGISWeb");
  if (!group) group = props.appendChild(xml.createElement("QGISWeb"));
  let el = group.querySelector(":scope > published");
  if (!el) {
    el = group.appendChild(xml.createElement("published"));
    el.setAttribute("type", "QString");
  }
  el.textContent = JSON.stringify(ref);
}

const API = "https://api.github.com";
const TOKEN_KEY = "qgisweb:github-token";
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? "";
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function gh(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${getToken()}`, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`GitHub: ${r.status} ${(await r.json().catch(() => ({}))).message ?? r.statusText}`);
  return r.json();
}

/** Publishes (or republishes, F23) the project. The share link stays the same across versions. */
export async function publish(meta: PublishMeta, opts: { gistId?: string | null; public: boolean }): Promise<Published> {
  const { qgs } = publishableProject();
  const files = { "project.qgs": { content: qgs }, "qgisweb.json": { content: JSON.stringify(meta, null, 2) } };
  const body = JSON.stringify({ description: `QGIS Web map: ${meta.name}`, files, ...(opts.gistId ? {} : { public: opts.public }) });
  const g = opts.gistId ? await gh(`/gists/${opts.gistId}`, { method: "PATCH", body }) : await gh("/gists", { method: "POST", body });
  return { id: g.id, owner: g.owner.login, public: g.public, url: g.html_url };
}

export async function history(gistId: string): Promise<{ version: string; committedAt: string }[]> {
  const commits = await gh(`/gists/${gistId}/commits`);
  return commits.map((c: { version: string; committed_at: string }) => ({ version: c.version, committedAt: c.committed_at }));
}

/** Restores an older version by publishing its content again as the newest. */
export async function restore(gistId: string, version: string) {
  const old = await gh(`/gists/${gistId}/${version}`);
  const files = Object.fromEntries(Object.entries(old.files as Record<string, { content: string }>).map(([n, f]) => [n, { content: f.content }]));
  await gh(`/gists/${gistId}`, { method: "PATCH", body: JSON.stringify({ files }) });
}

const raw = (owner: string, id: string, file: string, rev?: string | null) =>
  `https://gist.githubusercontent.com/${owner}/${id}/raw/${rev ? rev + "/" : ""}${file}?t=${Date.now()}`;

/** Loads a published project (no account needed): `?gist=owner/id[&rev=version]`. */
export async function loadPublished(ref: string, rev?: string | null) {
  const [owner, id] = ref.split("/");
  const [qgs, meta] = await Promise.all([
    fetch(raw(owner, id, "project.qgs", rev)).then((r) => {
      if (!r.ok) throw new Error(t("This shared map was not found ({status})", { status: r.status }));
      return r.arrayBuffer();
    }),
    fetch(raw(owner, id, "qgisweb.json", rev)).then((r) => (r.ok ? (r.json() as Promise<PublishMeta>) : null)).catch(() => null),
  ]);
  return { qgs: new Uint8Array(qgs), meta };
}

/** F22: whether this page, if embedded, is on a domain the owner approved. */
export function embedAllowed(meta: PublishMeta | null) {
  if (window.top === window || !meta?.allowedDomains?.length) return true;
  const parent = location.ancestorOrigins?.[0] ?? document.referrer;
  if (!parent) return false;
  const host = new URL(parent).hostname;
  return meta.allowedDomains.some((d) => host === d || host.endsWith("." + d));
}

