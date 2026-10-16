import { IdentifyMode, LayerType, type QgsGeometry, type QgsVectorLayer } from "qgis-js";
import type { Coordinate } from "ol/coordinate";
import { strToU8, zipSync } from "fflate";
import { engine, fetchProject, free, mountFiles, PROJECT_EXT } from "./engine";
import { newDoc, openDoc, project, projectBytes, projectFiles, reload } from "./doc";
import emptyProject from "../templates/empty.qgs?raw";
import { saveProject, loadProjectFiles, type StoredProject } from "./storage";
import { addData, embeddedProjects, DATA_EXT } from "./adddata";
import { hydrateAll } from "./remote";
import { ALGORITHMS } from "./processing";
import { resetHistory, undoProject, redoProject } from "./history";
import { readBookmarks, zoomToBookmark } from "./bookmarks";
import { discardAutosave } from "./autosave";
import { readAutosave, loadAutosaveFiles } from "./storage";
import { getSettings, lastProject, rememberLast, type ProjectRef } from "./settings";
import { listProjects } from "./storage";
import { showProject, hitBox, srid, setHighlight, zoomToFull, olMap as olMapRef } from "./map";
import { setVisible, snapshotTree, flatLayers } from "./tree";
import { ui, changed, toast, featureAttributes, type IdentifyHit } from "./state.svelte";

function opened(name: string, storedId: string | null) {
  resetHistory();
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
    ui.status = "Loading remote layers…";
    await hydrateAll();
    reload();
    opened(name, storedId);
  } catch (e) {
    ui.phase = "error";
    ui.error = (e as Error).message;
  }
}

/**
 * Handles picked or dropped files: a project file opens the project (with the data next to it);
 * a GeoPackage carrying a QGIS project opens that project; anything else is added as layers.
 */
export async function openFiles(files: { path: string; data: File }[]) {
  const projects = files.filter((f) => PROJECT_EXT.test(f.path));
  if (!projects.length) {
    if (ui.phase !== "ready") {
      for (const g of files.filter((f) => /\.gpkg$/i.test(f.path))) {
        const [embedded] = await embeddedProjects(new Uint8Array(await g.data.arrayBuffer()));
        if (!embedded) continue;
        const qgz = g.path.replace(/[^/]+$/, `${embedded.name}.qgz`);
        return open(embedded.name, async () => {
          const root = await mountFiles([...files, { path: qgz, data: embedded.content }]);
          return { root, path: `${root}/${qgz}` };
        });
      }
    }
    if (files.some((f) => DATA_EXT.test(f.path))) await addData(files);
    else toast("Drop a QGIS project (.qgs/.qgz) or data files (GeoPackage, GeoJSON, Shapefile, GeoTIFF…).");
    return;
  }
  const project = projects.sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  await open(project.data.name, async () => {
    const root = await mountFiles(files);
    return { root, path: `${root}/${project.path}` };
  });
  ui.sourceUrl = null;
  if (ui.phase === "ready") rememberLast({ kind: "local", name: ui.projectName });
}

export async function openStored(meta: StoredProject) {
  const files = await loadProjectFiles(meta.id);
  await open(meta.name, async () => {
    const root = await mountFiles(files);
    return { root, path: `${root}/${meta.projectPath}` };
  }, meta.id);
  ui.sourceUrl = meta.sourceUrl ?? null;
  ui.projectName = meta.name;
  if (ui.phase === "ready") rememberLast({ kind: "stored", id: meta.id, name: meta.name });
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
  discardAutosave();
  rememberLast({ kind: "stored", id, name: ui.projectName });
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
  if (ui.sourceUrl) rememberLast({ kind: "url", url: ui.sourceUrl, name: ui.projectName });
}

export const openDemo = () => openUrl(DEMO_URL);

/** Opens a published map (F21): only the project file is fetched, its layers are all remote. */
export async function openPublished(ref: string, rev: string | null) {
  const { loadPublished, embedAllowed } = await import("./publish");
  await open("shared map", async () => {
    const { qgs, meta } = await loadPublished(ref, rev);
    if (!embedAllowed(meta)) ui.embedBlocked = meta!.allowedDomains.join(", ");
    const root = await mountFiles([{ path: "project.qgs", data: qgs }]);
    return { root, path: `${root}/project.qgs` };
  });
  if (ui.phase === "ready" && !rev) rememberLast({ kind: "gist", ref, name: ui.projectName });
}

/** Reopens a remembered project; returns false (with a message) if it is no longer available. */
export async function openRef(ref: ProjectRef): Promise<boolean> {
  if (ref.kind === "url") await openUrl(ref.url);
  else if (ref.kind === "gist") await openPublished(ref.ref, null);
  else if (ref.kind === "stored") {
    const meta = (await listProjects()).find((p) => p.id === ref.id);
    if (!meta) return toast(`“${ref.name}” is no longer saved in this browser.`), false;
    await openStored(meta);
  } else return toast(`“${ref.name}” was opened from local files. Save it in the browser to reopen it on launch.`), false;
  return ui.phase === "ready";
}

/** Reopens the work found in the autosave slot (unsaved changes from a previous session). */
export async function recoverAutosave() {
  const meta = await readAutosave();
  if (!meta) return;
  const files = await loadAutosaveFiles();
  await open(meta.name, async () => {
    const root = await mountFiles(files);
    return { root, path: `${root}/${meta.projectPath}` };
  }, meta.storedId);
  ui.projectName = meta.name;
  ui.sourceUrl = meta.sourceUrl ?? null;
  ui.dirty = true;
}

/** Applies the "open project on launch" setting (when the URL doesn't name a project). */
export async function runStartup() {
  // Unsaved work from a previous session comes first: the welcome page offers to recover it.
  if (await readAutosave()) return;
  const { startup, specific } = getSettings();
  if (startup === "blank") await newProject();
  else if (startup === "last") {
    const last = lastProject();
    if (last) await openRef(last);
  } else if (startup === "specific" && specific) await openRef(specific);
  // A project that failed to open falls back to the welcome page.
  if (ui.phase === "error" && startup !== "welcome") {
    toast(ui.error);
    ui.phase = "empty";
  }
}

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
    const ctx = vl ? vl.createExpressionContext() : null;
    for (const f of r.features) {
      let title = `#${f.id()}`;
      if (expr && ctx) {
        ctx.setFeature(f);
        title = String(expr.evaluate(ctx) ?? title);
      }
      const template = vl?.mapTipTemplate();
      let tip: string | undefined;
      if (template && ctx) {
        ctx.setFeature(f);
        tip = api.QgsExpression.replaceExpressionText(template, ctx);
      }
      hits.push({ layerId: r.layer.id(), layerName: r.layer.name, fid: f.id(), title, attributes: featureAttributes(f), tip });
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

/** Shows one feature in the identify panel (e.g. a feature just digitized). */
export function identifyFeature(layerId: string, fid: number) {
  const api = engine();
  const layer = engine().layerTreeRoot().findLayer(layerId)?.layer() as QgsVectorLayer | undefined;
  if (!layer) return;
  const req = new api.QgsFeatureRequest();
  req.setFilterFid(fid);
  req.setDestinationCrs(srid());
  const it = layer.getFeatures(req);
  const f = it.nextFeature();
  if (f) {
    ui.hits = [{ layerId, layerName: layer.name, fid, title: `#${fid}`, attributes: featureAttributes(f) }];
    setHighlight([f.geometry()]);
  }
  free(f);
  free(it);
  free(req);
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
    { id: "panel-tools", label: "Show Processing tools", run: () => (ui.panel = "tools") },
    { id: "panel-hub", label: "Browse the QGIS Hub", run: () => (ui.panel = "hub") },
    { id: "panel-bookmarks", label: "Show Bookmarks", run: () => (ui.panel = "bookmarks") },
    { id: "panel-close", label: "Close side panel", run: () => (ui.panel = null) },
  ];
  if (ui.phase !== "ready") return base;
  const layers = flatLayers(snapshotTree());
  return [
    ...base,
    { id: "full", label: "Zoom to full extent", run: zoomToFull },
    { id: "undo", label: "Undo", hint: "Ctrl+Z", run: () => (ui.editing ? import("./editing").then((m) => m.undo()) : undoProject()) },
    { id: "redo", label: "Redo", hint: "Ctrl+Shift+Z", run: () => (ui.editing ? import("./editing").then((m) => m.redo()) : redoProject()) },
    { id: "project", label: "Project properties (title, CRS)…", run: () => (ui.dialog = "project") },
    { id: "save", label: "Save in this browser", hint: "Ctrl+S", run: saveInBrowser },
    { id: "download", label: "Download project file (.qgz)", run: downloadProject },
    { id: "bundle", label: "Download project with data (.zip)", run: downloadBundle },
    { id: "new", label: "New empty project", run: newProject },
    { id: "settings", label: "Settings (open project on launch)…", run: () => (ui.dialog = "settings") },
    { id: "add-data", label: "Add data files…", run: () => document.getElementById("pick-data")?.click() },
    { id: "add-osm", label: "Add OpenStreetMap basemap", run: () => import("./remote").then((r) => r.addRemote(r.PRESETS[0])) },
    { id: "share", label: "Share / publish…", run: () => (ui.dialog = "share") },
    { id: "export-image", label: "Export map image (PNG)…", run: () => (ui.dialog = "export") },
    { id: "measure-line", label: "Measure distance", run: () => import("./maptools").then((m) => m.startMeasure("line")) },
    { id: "measure-area", label: "Measure area", run: () => import("./maptools").then((m) => m.startMeasure("area")) },
    { id: "legend", label: "Show/hide legend on map", run: () => (ui.showLegend = !ui.showLegend) },
    { id: "select-tool", label: "Select features (click)", run: () => (ui.mapTool = "select") },
    { id: "clear-selection", label: "Clear all selections", run: () => import("./selection").then((m) => m.clearSelection()) },
    { id: "zoom-selection", label: "Zoom to selection", run: () => import("./selection").then((m) => m.zoomToSelection()) },
    { id: "maptips", label: "Toggle map tips", run: () => (ui.mapTips = !ui.mapTips) },
    { id: "compare", label: "Compare layers (swipe / side by side)", run: () => (ui.compare.active = !ui.compare.active) },
    ...(ui.editing
      ? [
          { id: "edit-stop", label: "Stop editing (saves)", run: () => import("./editing").then((m) => m.stopEditing()) },
          { id: "edit-undo", label: "Undo edit", hint: "Ctrl+Z", run: () => import("./editing").then((m) => m.undo()) },
          { id: "edit-redo", label: "Redo edit", hint: "Ctrl+Shift+Z", run: () => import("./editing").then((m) => m.redo()) },
          ...(["add", "modify", "delete"] as const).map((t) => ({ id: `edit-${t}`, label: `Edit tool: ${{ add: "add feature", modify: "edit vertices", delete: "delete feature" }[t]}`, run: () => import("./editmap").then((m) => m.setTool(t)) })),
        ]
      : []),
    ...ALGORITHMS.map((a) => ({ id: `alg-${a.id}`, label: `Processing: ${a.name}`, hint: a.id, run: () => ((ui.panel = "tools"), (ui.pendingAlgorithm = a.id)) })),
    { id: "clear", label: "Clear identify results", run: clearIdentify },
    { id: "close-table", label: "Close attribute table", run: () => (ui.tableLayerId = null) },
    ...readBookmarks().map((b) => ({ id: `bm-${b.id}`, label: `Go to bookmark: ${b.name}`, run: () => zoomToBookmark(b) })),
    ...layers.flatMap((l) => [
      { id: `toggle-${l.layerId}`, label: `Toggle visibility: ${l.name}`, run: () => setVisible(l, !l.checked) },
      { id: `zoom-${l.layerId}`, label: `Zoom to layer: ${l.name}`, run: () => { const e = engine().fullExtent([l.layerId!]); olMapRef().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [40, 40, 40, 40] }); } },
      { id: `style-${l.layerId}`, label: `Style: ${l.name}`, run: () => ((ui.current = l.layerId!), (ui.panel = "style")) },
      ...(l.layerType === LayerType.Vector && l.valid
        ? [
            { id: `table-${l.layerId}`, label: `Open attribute table: ${l.name}`, run: () => (ui.tableLayerId = l.layerId!) },
            { id: `selexpr-${l.layerId}`, label: `Select by expression: ${l.name}`, run: () => ((ui.current = l.layerId!), (ui.dialog = "select-expression")) },
            { id: `selloc-${l.layerId}`, label: `Select by location: ${l.name}`, run: () => ((ui.current = l.layerId!), (ui.dialog = "select-location")) },
            { id: `calc-${l.layerId}`, label: `Field calculator: ${l.name}`, run: () => ((ui.current = l.layerId!), (ui.dialog = "field-calc")) },
            { id: `export-${l.layerId}`, label: `Export layer: ${l.name}`, run: () => ((ui.current = l.layerId!), (ui.dialog = "export-layer")) },
            { id: `edit-${l.layerId}`, label: `Start editing: ${l.name}`, run: () => import("./editing").then((m) => (m.canEdit(l.layerId!) ? m.startEditing(l.layerId!) : m.convertToGpkg(l.layerId!).then(() => m.startEditing(l.layerId!)))) },
          ]
        : []),
    ]),
  ];
}
