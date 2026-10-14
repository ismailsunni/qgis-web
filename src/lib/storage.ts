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

export async function saveProject(meta: StoredProject, files: Record<string, Uint8Array>) {
  const root = await projectsDir();
  await root.removeEntry(meta.id, { recursive: true }).catch(() => {});
  const dir = await root.getDirectoryHandle(meta.id, { create: true });
  for (const [path, data] of Object.entries({ ...files, "qgisweb-meta.json": new TextEncoder().encode(JSON.stringify(meta)) })) {
    const parts = path.split("/");
    const handle = await (await dirFor(dir, parts.slice(0, -1))).getFileHandle(parts.at(-1)!, { create: true });
    const w = await handle.createWritable();
    await w.write(data as Uint8Array<ArrayBuffer>);
    await w.close();
  }
  await navigator.storage.persist?.();
}

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

export async function loadProjectFiles(id: string) {
  const files: { path: string; data: File }[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else if (name !== "qgisweb-meta.json") files.push({ path: prefix + name, data: await (h as FileSystemFileHandle).getFile() });
    }
  };
  await walk(await (await projectsDir()).getDirectoryHandle(id), "");
  return files;
}

export async function deleteProject(id: string) {
  await (await projectsDir()).removeEntry(id, { recursive: true });
}
