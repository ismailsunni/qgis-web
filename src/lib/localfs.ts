import { exists, readFile, unsavedFiles } from "./engine";
import { projectBytes } from "./doc";
import { writeAll } from "./storage";
import { t } from "./i18n";

/**
 * Projects opened from the computer stay linked to their files (File System Access API, in
 * Chromium browsers): Save writes the project and the changed data back in place, as Desktop does.
 * Elsewhere files are only read, and saving makes a copy.
 */

export type PickedFile = { path: string; data: File; handle?: FileSystemFileHandle };
export interface LocalLink { id: string; name: string; projectPath: string; dir: FileSystemDirectoryHandle | null; files: Record<string, FileSystemFileHandle> }
/** Files located for unavailable layers (see relocate.ts), by layer id. */
type Relocations = Record<string, { path: string; handle: FileSystemFileHandle }[]>;

export const canLink = typeof window !== "undefined" && "showDirectoryPicker" in window;

let link: (LocalLink & { root: string; relocated: Relocations }) | null = null;
export const linked = () => link;

export async function readDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (h.kind === "directory") out.push(...(await readDir(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`)));
    else out.push({ path: prefix + h.name, data: await (h as FileSystemFileHandle).getFile(), handle: h as FileSystemFileHandle });
  }
  return out;
}

const fileHandles = (files: PickedFile[]) => Object.fromEntries(files.filter((f) => f.handle).map((f) => [f.path, f.handle!]));

export async function pickFolder(startIn?: FileSystemHandle) {
  const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: "quarkgis", mode: "readwrite", ...(startIn && { startIn }) });
  return { files: await readDir(dir, `${dir.name}/`), dir };
}

export async function pickFiles(startIn?: FileSystemHandle) {
  const handles = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ id: "quarkgis", multiple: true, ...(startIn && { startIn }) });
  return { files: await Promise.all(handles.map(async (h) => ({ path: h.name, data: await h.getFile(), handle: h }))), dir: null };
}

/** Files and folders dropped on the page, with their handles where the browser gives them. */
export async function droppedHandles(dt: DataTransfer) {
  const items = [...dt.items].filter((i) => i.kind === "file") as (DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> })[];
  const handles = (await Promise.all(items.map((i) => i.getAsFileSystemHandle()))).filter((h): h is FileSystemHandle => !!h);
  const dirs = handles.filter((h) => h.kind === "directory") as FileSystemDirectoryHandle[];
  const files: PickedFile[] = [];
  for (const d of dirs) files.push(...(await readDir(d, `${d.name}/`)));
  for (const h of handles.filter((h) => h.kind === "file") as FileSystemFileHandle[]) files.push({ path: h.name, data: await h.getFile(), handle: h });
  return { files, dir: dirs.length === 1 && dirs.length === handles.length ? dirs[0] : null };
}

/** Links the open project (mounted at `root`) to the files it was read from. */
export async function linkProject(root: string, projectPath: string, name: string, dir: FileSystemDirectoryHandle | null, files: PickedFile[], id: string = crypto.randomUUID()) {
  const relocated = (await getRecent(id).catch(() => undefined))?.relocated ?? {};
  link = { id, name, projectPath, dir, files: fileHandles(files), root, relocated };
  unsavedFiles.clear();
  await saveRecent();
  return { id, relocated };
}

const saveRecent = () =>
  link ? putRecent({ id: link.id, name: link.name, projectPath: link.projectPath, dir: link.dir, files: link.files, relocated: link.relocated, openedAt: new Date().toISOString() }).catch(() => {}) : Promise.resolve();

/** Remembers where an unavailable layer's files were found, to find them again next time. */
export async function rememberRelocation(id: string, files: PickedFile[]) {
  if (!link || !files.every((f) => f.handle)) return;
  link.relocated[id] = files.map((f) => ({ path: f.path, handle: f.handle! }));
  await saveRecent();
}

/** The remembered located files, read again (permission is asked for if needed). */
export async function readRelocations(r: Relocations) {
  const out: [string, PickedFile[]][] = [];
  for (const [id, files] of Object.entries(r)) {
    try {
      out.push([id, await Promise.all(files.map(async (f) => ((await writable(f.handle)) ? { path: f.path, data: await f.handle.getFile(), handle: f.handle } : Promise.reject())))]);
    } catch {
      // Moved or no permission: the layer stays unavailable and can be located again.
    }
  }
  return out;
}

export const unlink = () => void (link = null);


export async function writable(h: FileSystemHandle) {
  const p = h as FileSystemHandle & { queryPermission(o: object): Promise<string>; requestPermission(o: object): Promise<string> };
  return (await p.queryPermission({ mode: "readwrite" })) === "granted" || (await p.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Writes the project and the data files changed since opening back to the computer. */
export async function saveToDisk() {
  const l = link!;
  const rel = (p: string) => p.slice(l.root.length + 1);
  const out: Record<string, Uint8Array> = { [l.projectPath]: projectBytes() };
  for (const p of unsavedFiles) if (p.startsWith(l.root + "/") && !p.endsWith(".quarkgis.qgs") && exists(p) && rel(p) !== l.projectPath) out[rel(p)] = readFile(p);
  const inDir: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(out)) {
    const h = l.files[path];
    if (h) {
      if (!(await writable(h))) throw new Error(t("No permission to write {name}", { name: h.name }));
      const w = await h.createWritable();
      await w.write(data as Uint8Array<ArrayBuffer>);
      await w.close();
    } else if (l.dir) inDir[path.slice(l.dir.name.length + 1)] = data;
    else throw new Error(t("{path} is new and can't be written next to the project files; open the project folder, or download the project with its data.", { path }));
  }
  if (Object.keys(inDir).length) {
    if (!(await writable(l.dir!))) throw new Error(t("No permission to write {name}", { name: l.dir!.name }));
    await writeAll(l.dir!, inDir);
  }
  unsavedFiles.clear();
  return Object.keys(out).length;
}

// ---- Recent local projects (handles kept in IndexedDB) ---------------------------------------

export interface LocalRecent { id: string; name: string; projectPath: string; dir: FileSystemDirectoryHandle | null; files: Record<string, FileSystemFileHandle>; relocated?: Relocations; openedAt: string }

function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("quarkgis", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("local", { keyPath: "id" });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction("local", mode).objectStore("local"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

const putRecent = (r: LocalRecent) => store("readwrite", (s) => s.put(r));
export const deleteRecent = (id: string) => store("readwrite", (s) => s.delete(id));
export const recentLocal = async () => ((await store<LocalRecent[]>("readonly", (s) => s.getAll()).catch(() => [])) ?? []).filter((r) => !r.id.startsWith("folder:")).sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 8);
export const getRecent = (id: string) => store<LocalRecent | undefined>("readonly", (s) => s.get(id));

/** Reads a recent project's files again (asks for permission if the browser needs it). */
export async function readRecent(r: LocalRecent) {
  for (const h of r.dir ? [r.dir] : Object.values(r.files)) if (!(await writable(h))) throw new Error(t("No permission to open {name}", { name: r.name }));
  const files = r.dir ? await readDir(r.dir, `${r.dir.name}/`) : await Promise.all(Object.entries(r.files).map(async ([path, h]) => ({ path, data: await h.getFile(), handle: h })));
  return { files, dir: r.dir };
}

// ---- Allowed folders: where missing data was found, to find it again for any project ---------

interface AllowedFolder { id: string; dir: FileSystemDirectoryHandle; usedAt: string }

export const allowedFolders = async () =>
  ((await store<AllowedFolder[]>("readonly", (s) => s.getAll()).catch(() => [])) ?? []).filter((r) => r.id.startsWith("folder:")).sort((a, b) => b.usedAt.localeCompare(a.usedAt));

export async function rememberFolder(dir: FileSystemDirectoryHandle) {
  const same = (await Promise.all((await allowedFolders()).map(async (f) => ((await f.dir.isSameEntry(dir)) ? f : null)))).find(Boolean);
  await store("readwrite", (s) => s.put({ id: same?.id ?? `folder:${crypto.randomUUID()}`, dir, usedAt: new Date().toISOString() })).catch(() => {});
}

export const permission = (h: FileSystemHandle) => (h as FileSystemHandle & { queryPermission(o: object): Promise<PermissionState> }).queryPermission({ mode: "readwrite" });

/** Asks only for a folder (no reading): the place to look for missing data. */
export const chooseFolder = (startIn?: FileSystemHandle) =>
  (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: "quarkgis-data", mode: "readwrite", ...(startIn && { startIn }) });

export const projectHandle = () => (link ? link.files[link.projectPath] : undefined);

const SHAPEFILE_PARTS = /\.(shp|shx|dbf|prj|cpg|qix|sbn|sbx)$/i;

/**
 * The file a project path points to inside an allowed folder: relative paths are followed from
 * the project file's place in the folder, absolute ones from the folder's name in the path.
 */
export async function findIn(root: FileSystemDirectoryHandle, path: string): Promise<PickedFile[] | null> {
  const parts = path.replace(/\\/g, "/").split("/");
  let segs: string[];
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    const i = parts.lastIndexOf(root.name);
    if (i < 0) return null;
    segs = parts.slice(i + 1);
  } else {
    const proj = projectHandle();
    const at = proj && (await root.resolve(proj).catch(() => null));
    if (!at) return null;
    segs = at.slice(0, -1);
    for (const p of parts)
      if (p === "..") {
        if (!segs.length) return null;
        segs.pop();
      } else if (p && p !== ".") segs.push(p);
  }
  try {
    let d = root;
    for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s);
    const name = segs.at(-1)!;
    const stem = name.replace(/\.[^.]+$/, "");
    const out: PickedFile[] = [];
    for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values())
      if (h.kind === "file" && (h.name === name || (SHAPEFILE_PARTS.test(name) && SHAPEFILE_PARTS.test(h.name) && h.name.replace(/\.[^.]+$/, "") === stem)))
        out.push({ path: [root.name, ...segs.slice(0, -1), h.name].join("/"), data: await (h as FileSystemFileHandle).getFile(), handle: h as FileSystemFileHandle });
    return out.some((f) => f.handle!.name === name) ? out.sort((a) => (a.handle!.name === name ? -1 : 1)) : null;
  } catch {
    return null;
  }
}
