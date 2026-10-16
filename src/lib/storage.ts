/** Projects saved in the browser's Origin Private File System. */

export interface StoredProject {
  id: string;
  name: string;
  /** Project file path relative to the stored folder. */
  projectPath: string;
  savedAt: string;
  /** Where it came from, e.g. a remote URL, to keep share links working. */
  sourceUrl?: string | null;
}

const projectsDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("projects", { create: true });

async function dirFor(parent: FileSystemDirectoryHandle, path: string[]) {
  let d = parent;
  for (const p of path) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}

async function writeAll(dir: FileSystemDirectoryHandle, files: Record<string, Uint8Array>) {
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split("/");
    const handle = await (await dirFor(dir, parts.slice(0, -1))).getFileHandle(parts.at(-1)!, { create: true });
    const w = await handle.createWritable();
    await w.write(data as Uint8Array<ArrayBuffer>);
    await w.close();
  }
}

const metaFile = (meta: object) => ({ "qgisweb-meta.json": new TextEncoder().encode(JSON.stringify(meta)) });

export async function saveProject(meta: StoredProject, files: Record<string, Uint8Array>) {
  const root = await projectsDir();
  await root.removeEntry(meta.id, { recursive: true }).catch(() => {});
  await writeAll(await root.getDirectoryHandle(meta.id, { create: true }), { ...files, ...metaFile(meta) });
  await navigator.storage.persist?.();
}

// ---- Autosave: one slot holding the unsaved work of the last session ----------------------

export interface AutosaveMeta extends StoredProject {
  /** The saved-in-browser project it belongs to, if any. */
  storedId: string | null;
}

const autosaveDir = async (create = true) => (await navigator.storage.getDirectory()).getDirectoryHandle("autosave", { create });

/** Writes files into the autosave slot; `reset` starts it afresh (a new session). */
export async function writeAutosave(meta: AutosaveMeta, files: Record<string, Uint8Array>, reset: boolean) {
  const root = await navigator.storage.getDirectory();
  if (reset) await root.removeEntry("autosave", { recursive: true }).catch(() => {});
  await writeAll(await autosaveDir(), { ...files, ...metaFile(meta) });
}

export async function readAutosave(): Promise<AutosaveMeta | null> {
  try {
    const f = await (await (await autosaveDir(false)).getFileHandle("qgisweb-meta.json")).getFile();
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

export async function clearAutosave() {
  await (await navigator.storage.getDirectory()).removeEntry("autosave", { recursive: true }).catch(() => {});
}

export const loadAutosaveFiles = async () => walkFiles(await autosaveDir(false));

export async function listProjects(): Promise<StoredProject[]> {
  if (!navigator.storage?.getDirectory) return [];
  const out: StoredProject[] = [];
  for await (const [, handle] of (await projectsDir()).entries()) {
    if (handle.kind !== "directory") continue;
    try {
      const f = await (await (handle as FileSystemDirectoryHandle).getFileHandle("qgisweb-meta.json")).getFile();
      out.push(JSON.parse(await f.text()));
    } catch {}
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function walkFiles(root: FileSystemDirectoryHandle) {
  const files: { path: string; data: File }[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else if (name !== "qgisweb-meta.json") files.push({ path: prefix + name, data: await (h as FileSystemFileHandle).getFile() });
    }
  };
  await walk(root, "");
  return files;
}

export const loadProjectFiles = async (id: string) => walkFiles(await (await projectsDir()).getDirectoryHandle(id));

export async function deleteProject(id: string) {
  await (await projectsDir()).removeEntry(id, { recursive: true });
}
