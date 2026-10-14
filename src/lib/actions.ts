import { IdentifyMode, LayerType, type QgsGeometry, type QgsVectorLayer } from "qgis-js";
import type { Coordinate } from "ol/coordinate";
import { strToU8, zipSync } from "fflate";
import { engine, fetchProject, free, mountFiles, PROJECT_EXT } from "./engine";
import { newDoc, openDoc, project, projectBytes, projectFiles } from "./doc";
import emptyProject from "../templates/empty.qgs?raw";
import { saveProject, loadProjectFiles, type StoredProject } from "./storage";
import { showProject, hitBox, srid, setHighlight, zoomToFull } from "./map";
import { setVisible, snapshotTree, flatLayers } from "./tree";
import { ui, changed, toast, featureAttributes, type IdentifyHit } from "./state.svelte";

function opened(name: string, storedId: string | null) {
  ui.storedId = storedId;
  ui.dirty = false;
  ui.editing = null;
  ui.projectName = engine().projectVariables()["project_title"] || name.replace(PROJECT_EXT, "");
  ui.tableLayerId = null;
  ui.current = flatLayers(snapshotTree()).find((l) => l.valid)?.layerId ?? null;
  ui.hits = [];
  ui.phase = "ready";
  changed();
  showProject();
  const broken = flatLayers(snapshotTree()).filter((l) => !l.valid && !l.remote);
  if (broken.length) toast(`Missing data for: ${broken.map((l) => l.name).join(", ")}`);
}

export async function newProject() {
  const root = await mountFiles([]);
  newDoc(root, emptyProject);
  opened("Untitled", null);
  ui.sourceUrl = null;
  ui.panel = "add";
}

export const DEMO_URL = `${import.meta.env.BASE_URL}projects/world/world.qgz`;

async function open(name: string, load: () => Promise<{ root: string; path: string }>, storedId: string | null = null) {
  ui.phase = "loading";
  ui.status = `Opening ${name}…`;
  try {
    const { root, path } = await load();
    openDoc(path, root);
    opened(name, storedId);
  } catch (e) {
    ui.phase = "error";
    ui.error = (e as Error).message;
  }
}

/** Opens a project from local files: the project file plus any data it references. */
export async function openFiles(files: { path: string; data: File }[]) {
  const projects = files.filter((f) => PROJECT_EXT.test(f.path));
  if (!projects.length) return toast("Drop a .qgs or .qgz project (with its data files or folder).");
  const project = projects.sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  await open(project.data.name, async () => {
    const root = await mountFiles(files);
    return { root, path: `${root}/${project.path}` };
  });
  ui.sourceUrl = null;
}

export async function openStored(meta: StoredProject) {
  const files = await loadProjectFiles(meta.id);
  await open(meta.name, async () => {
    const root = await mountFiles(files);
    return { root, path: `${root}/${meta.projectPath}` };
  }, meta.id);
  ui.sourceUrl = meta.sourceUrl ?? null;
  ui.projectName = meta.name;
}

/** Saves the project and its data in the browser (OPFS). */
export async function saveInBrowser() {
  if (ui.phase !== "ready") return;
  const d = project();
  const id = ui.storedId ?? crypto.randomUUID();
  await saveProject(
    { id, name: ui.projectName, projectPath: `${d.dir}/${d.file}`.slice(d.root.length + 1), savedAt: new Date().toISOString(), sourceUrl: ui.sourceUrl },
    projectFiles(),
  );
  ui.storedId = id;
  ui.dirty = false;
  toast(`Saved “${ui.projectName}” in this browser`);
}

function download(data: Uint8Array | string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([typeof data === "string" ? strToU8(data) : (data as Uint8Array<ArrayBuffer>)]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Downloads the project file (.qgz/.qgs) only. */
export const downloadProject = () => download(projectBytes(), project().file);

/** Downloads the project with all its local data as a .zip that opens in QGIS Desktop. */
export function downloadBundle() {
  const files = projectFiles();
  const paths = Object.keys(files);
  // Strip folders shared by every file so the zip opens at the project's own folder.
  let prefix = paths[0].split("/").slice(0, -1);
  for (const p of paths) while (prefix.length && !p.startsWith(prefix.join("/") + "/")) prefix.pop();
  const cut = prefix.length ? prefix.join("/").length + 1 : 0;
  download(zipSync(Object.fromEntries(paths.map((p) => [p.slice(cut), files[p]]))), `${ui.projectName || "project"}.zip`);
}

export async function openUrl(url: string) {
  await open(decodeURIComponent(url.split("/").pop()!), () => fetchProject(url));
  ui.sourceUrl = ui.phase === "ready" ? new URL(url, location.href).href : null;
}

export const openDemo = () => openUrl(DEMO_URL);

/** Flattens a drop (files and folders) into relative paths. */
export async function droppedFiles(dt: DataTransfer) {
  const out: { path: string; data: File }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + file.name, data: file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        await Promise.all(batch.map((e) => walk(e, `${prefix}${entry.name}/`)));
      } while (batch.length);
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  await Promise.all(entries.map((e) => walk(e, "")));
  return out;
}

export const pickedFiles = (list: FileList) =>
  [...list].map((f) => ({ path: f.webkitRelativePath || f.name, data: f }));

export function identifyAt(coord: Coordinate) {
  const api = engine();
  const rect = hitBox(coord);
  const results = api.identify(rect, srid(), IdentifyMode.TopDownAll);
  free(rect);
  const hits: IdentifyHit[] = [];
  const geoms: QgsGeometry[] = [];
  for (const r of results) {
    const vl = r.layer.type() === LayerType.Vector ? (r.layer as QgsVectorLayer) : null;
    const expr = vl?.displayExpression() ? new api.QgsExpression(vl.displayExpression()) : null;
    const ctx = expr ? vl!.createExpressionContext() : null;
    for (const f of r.features) {
      let title = `#${f.id()}`;
      if (expr && ctx) {
        ctx.setFeature(f);
        title = String(expr.evaluate(ctx) ?? title);
      }
      hits.push({ layerId: r.layer.id(), layerName: r.layer.name, fid: f.id(), title, attributes: featureAttributes(f) });
      geoms.push(f.geometry());
      free(f);
    }
    free(expr);
    free(ctx);
  }
  ui.hits = hits;
  ui.hitAt = hits.length ? [coord[0], coord[1]] : null;
  setHighlight(geoms);
}

export function clearIdentify() {
  ui.hits = [];
  ui.hitAt = null;
  setHighlight([]);
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Everything reachable from the command palette (Ctrl/Cmd+K). */
export function commands(): Command[] {
  const base: Command[] = [
    { id: "open", label: "Open project…", hint: "Ctrl+O", run: () => document.getElementById("pick-files")?.click() },
    { id: "open-folder", label: "Open project folder…", run: () => document.getElementById("pick-folder")?.click() },
    { id: "demo", label: "Open demo project", run: openDemo },
    { id: "panel-layers", label: "Show Layers panel", run: () => (ui.panel = "layers") },
    { id: "panel-add", label: "Show Add data panel", run: () => (ui.panel = "add") },
    { id: "panel-style", label: "Show Style panel", run: () => (ui.panel = "style") },
    { id: "panel-close", label: "Close side panel", run: () => (ui.panel = null) },
  ];
  if (ui.phase !== "ready") return base;
  const layers = flatLayers(snapshotTree());
  return [
    ...base,
    { id: "full", label: "Zoom to full extent", run: zoomToFull },
    { id: "clear", label: "Clear identify results", run: clearIdentify },
    { id: "close-table", label: "Close attribute table", run: () => (ui.tableLayerId = null) },
    ...layers.flatMap((l) => [
      { id: `toggle-${l.layerId}`, label: `Toggle visibility: ${l.name}`, run: () => setVisible(l, !l.checked) },
      ...(l.layerType === LayerType.Vector ? [{ id: `table-${l.layerId}`, label: `Open attribute table: ${l.name}`, run: () => (ui.tableLayerId = l.layerId!) }] : []),
    ]),
  ];
}
