import { qgis, type QgisApi, type QgsLayerTreeNode, type QgsLayerTreeLayer, LayerType } from "qgis-js";
import { unzipSync, strFromU8 } from "fflate";

export type EmFS = Awaited<ReturnType<typeof qgis>>["fs"];

let api: QgisApi;
let fs: EmFS;

export async function boot(onStatus: (s: string) => void) {
  ({ api, fs } = await qgis({ prefix: `${import.meta.env.BASE_URL}assets/wasm`, onStatus }));
  return api;
}

export const engine = () => api;

/** Frees an embind handle; engine objects are not garbage collected. */
export const free = (o: unknown) => (o as { delete?: () => void } | null)?.delete?.();

export const PROJECT_EXT = /\.(qgs|qgz)$/i;
let session = 0;

function writeFile(path: string, data: Uint8Array) {
  const parts = path.split("/").filter(Boolean);
  let dir = "";
  for (const p of parts.slice(0, -1)) {
    dir += "/" + p;
    if (!fs.analyzePath(dir).exists) fs.mkdir(dir);
  }
  fs.writeFile(path, data);
}

/** Writes files (with relative paths) into a fresh virtual folder and returns its root. */
export async function mountFiles(files: { path: string; data: Blob | Uint8Array }[]) {
  const root = `/session${++session}`;
  for (const f of files) {
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    writeFile(`${root}/${f.path.replace(/^\/+/, "")}`, data);
  }
  return root;
}

export function loadProject(path: string) {
  if (!api.loadProject(path)) throw new Error(`QGIS could not open ${path.split("/").pop()}`);
}

/** Relative data sources referenced by a .qgs/.qgz, so a remote project can fetch them. */
function relativeSources(name: string, data: Uint8Array) {
  const xml = name.toLowerCase().endsWith(".qgz")
    ? strFromU8(Object.entries(unzipSync(data)).find(([n]) => n.endsWith(".qgs"))![1])
    : strFromU8(data);
  const out = new Set<string>();
  for (const [, src] of xml.matchAll(/<datasource>([^<]+)<\/datasource>/g)) {
    const file = src.split("|")[0].replace(/&amp;/g, "&");
    if (file.startsWith("./") || file.startsWith("../")) out.add(file);
  }
  return [...out];
}

const SIDECARS: Record<string, string[]> = { shp: ["shx", "dbf", "prj", "cpg", "qix"] };

/** Fetches a remote project plus its relative data files into the virtual FS. */
export async function fetchProject(url: string) {
  const abs = new URL(url, location.href);
  const name = decodeURIComponent(abs.pathname.split("/").pop()!);
  const res = await fetch(abs);
  if (!res.ok) throw new Error(`Could not fetch ${abs} (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  // Nest the project a few folders deep so "../" sources still land inside the session root.
  const local = (src: string) => decodeURIComponent(new URL(src, `http://v/a/b/c/${encodeURIComponent(name)}`).pathname);
  const files: { path: string; data: Uint8Array }[] = [{ path: local(name), data }];
  const wanted = relativeSources(name, data).flatMap((src) => {
    const ext = src.split(".").pop()!.toLowerCase();
    return [src, ...(SIDECARS[ext] ?? []).map((e) => src.replace(/[^.]+$/, e))];
  });
  await Promise.all(
    wanted.map(async (src) => {
      const r = await fetch(new URL(src, abs)).catch(() => null);
      if (r?.ok) files.push({ path: local(src), data: new Uint8Array(await r.arrayBuffer()) });
    }),
  );
  return (await mountFiles(files)) + local(name);
}

export interface TreeNode {
  key: string;
  name: string;
  isGroup: boolean;
  checked: boolean;
  visible: boolean;
  expanded: boolean;
  layerId?: string;
  layerType?: LayerType;
  valid?: boolean;
  opacity?: number;
  children: TreeNode[];
  node: QgsLayerTreeNode;
}

/** A plain snapshot of the engine's layer tree; re-read after every change. */
export function snapshotTree(): TreeNode[] {
  const walk = (n: QgsLayerTreeNode, key: string, parentVisible: boolean): TreeNode => {
    const checked = n.itemVisibilityChecked;
    const base = { key, name: n.name, checked, visible: parentVisible && checked, expanded: n.expanded, node: n };
    if (n.isGroup()) {
      return { ...base, isGroup: true, children: n.children().map((c, i) => walk(c, `${key}/${i}`, base.visible)) };
    }
    const layer = (n as QgsLayerTreeLayer).layer();
    return {
      ...base,
      isGroup: false,
      layerId: (n as QgsLayerTreeLayer).layerId(),
      layerType: layer?.type(),
      valid: !!layer?.isValid(),
      opacity: layer?.opacity ?? 1,
      children: [],
    };
  };
  return api.layerTreeRoot().children().map((c, i) => walk(c, `${i}`, true));
}

export const flatLayers = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((n) => (n.isGroup ? flatLayers(n.children) : [n]));

export function findMapLayer(layerId: string) {
  return api.layerTreeRoot().findLayer(layerId)?.layer() ?? null;
}

/** Map units of the project CRS, derived from its PROJ definition. */
export function projectUnits(): "degrees" | "m" | "ft" | "us-ft" {
  const def = api.projectVariables()["project_crs_definition"] ?? "";
  if (/\+proj=longlat/.test(def)) return "degrees";
  if (/\+units=us-ft/.test(def)) return "us-ft";
  if (/\+units=ft/.test(def)) return "ft";
  return "m";
}
