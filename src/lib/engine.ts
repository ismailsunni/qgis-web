import { qgis, type QgisApi } from "qgis-js";
import { unzipSync, strFromU8 } from "fflate";

export type EmFS = Awaited<ReturnType<typeof qgis>>["fs"];

let api: QgisApi;
let fs: EmFS;

export async function boot(onStatus: (s: string) => void) {
  ({ api, fs } = await qgis({ prefix: `${import.meta.env.BASE_URL}assets/wasm`, onStatus }));
  // Handle for end-to-end tests and debugging from the console.
  Object.assign(globalThis, { qgisWeb: { api, fs } });
  return api;
}

export const engine = () => api;

/** Frees an embind handle; engine objects are not garbage collected. */
export const free = (o: unknown) => (o as { delete?: () => void } | null)?.delete?.();

export const PROJECT_EXT = /\.(qgs|qgz)$/i;
let session = 0;

export const readFile = (path: string) => fs.readFile(path) as Uint8Array;
export const exists = (path: string) => fs.analyzePath(path).exists;

/** All files under a folder, as absolute paths. */
export function listFiles(dir: string): string[] {
  return (fs.readdir(dir) as string[])
    .filter((n) => n !== "." && n !== "..")
    .flatMap((n) => {
      const p = `${dir}/${n}`;
      return fs.isDir(fs.stat(p).mode) ? listFiles(p) : [p];
    });
}

export function writeFile(path: string, data: Uint8Array | string) {
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
  const root = await mountFiles(files);
  return { root, path: root + local(name) };
}

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
