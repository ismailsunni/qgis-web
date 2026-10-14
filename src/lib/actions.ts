import { IdentifyMode, LayerType, type QgsGeometry, type QgsLayerTreeNode, type QgsVectorLayer } from "qgis-js";
import type { Coordinate } from "ol/coordinate";
import { engine, fetchProject, free, loadProject, mountFiles, PROJECT_EXT, snapshotTree, flatLayers } from "./engine";
import { showProject, hitBox, srid, setHighlight, zoomToFull, redraw } from "./map";
import { ui, changed, toast, featureAttributes, type IdentifyHit } from "./state.svelte";

export const DEMO_URL = `${import.meta.env.BASE_URL}projects/world/world.qgz`;

async function open(name: string, load: () => Promise<string>) {
  ui.phase = "loading";
  ui.status = `Opening ${name}…`;
  try {
    loadProject(await load());
    ui.projectName = engine().projectVariables()["project_title"] || name.replace(PROJECT_EXT, "");
    ui.tableLayerId = null;
    ui.current = flatLayers(snapshotTree()).find((l) => l.valid)?.layerId ?? null;
    ui.hits = [];
    ui.phase = "ready";
    changed();
    showProject();
    const broken = flatLayers(snapshotTree()).filter((l) => !l.valid);
    if (broken.length) toast(`Missing data for: ${broken.map((l) => l.name).join(", ")}`);
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
  await open(project.data.name, async () => `${await mountFiles(files)}/${project.path}`);
  ui.sourceUrl = null;
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
      { id: `toggle-${l.layerId}`, label: `Toggle visibility: ${l.name}`, run: () => toggleNode(l.node) },
      ...(l.layerType === LayerType.Vector ? [{ id: `table-${l.layerId}`, label: `Open attribute table: ${l.name}`, run: () => (ui.tableLayerId = l.layerId!) }] : []),
    ]),
  ];
}

export function toggleNode(node: QgsLayerTreeNode) {
  node.itemVisibilityChecked = !node.itemVisibilityChecked;
  changed();
  redraw();
}
