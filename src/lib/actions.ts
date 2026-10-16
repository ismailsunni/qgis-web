import { IdentifyMode, LayerType, type QgsGeometry, type QgsVectorLayer } from "qgis-js";
import type { Coordinate } from "ol/coordinate";
import { strToU8, zipSync } from "fflate";
import { unsavedFiles, engine, fetchProject, free, mountFiles, PROJECT_EXT } from "./engine";
import { newDoc, openDoc, project, projectBytes, projectFiles, reload } from "./doc";
import emptyProject from "../templates/empty.qgs?raw";
import { saveProject, loadProjectFiles, type StoredProject } from "./storage";
import { addData, embeddedProjects, DATA_EXT } from "./adddata";
import { hydrateAll, PRESETS, addRemote } from "./remote";
import { ALGORITHMS } from "./processing";
import { resetHistory, undoProject, redoProject } from "./history";
import { readBookmarks, zoomToBookmark } from "./bookmarks";
import { discardAutosave } from "./autosave";
import { emit, setAllowedDomains } from "./embed";
import { readAutosave, loadAutosaveFiles } from "./storage";
import { getSettings, lastProject, rememberLast, type ProjectRef } from "./settings";
import { listProjects } from "./storage";
import { showProject, hitBox, srid, setHighlight, zoomToFull, olMap as olMapRef } from "./map";
import { setVisible, snapshotTree, flatLayers } from "./tree";
import { resetViews, savedExtent, previousView, nextView, toggleGrid } from "./navigation";
import { isGeoTiff, pixelSampler } from "./raster";
import { canLink, linked, linkProject, saveToDisk, pickFiles, pickFolder, readRecent, getRecent, unlink, type LocalRecent, type PickedFile } from "./localfs";
import { ui, changed, toast, featureAttributes, type IdentifyHit } from "./state.svelte";
import { t, N_ } from "./i18n";

function opened(name: string, storedId: string | null) {
  resetHistory();
  unlink();
  ui.local = null;
  ui.storedId = storedId;
  ui.dirty = false;
  ui.editing = null;
  ui.projectName = engine().projectVariables()["project_title"] || name.replace(PROJECT_EXT, "");
  ui.tableLayerId = null;
  ui.current = flatLayers(snapshotTree()).find((l) => l.valid)?.layerId ?? null;
  ui.hits = [];
  ui.time.active = false;
  ui.phase = "ready";
  changed();
  showProject();
  const saved = getSettings().view === "saved" && savedExtent();
  if (saved) olMapRef().getView().fit(saved);
  resetViews();
  const broken = flatLayers(snapshotTree()).filter((l) => !l.valid && !l.remote);
  if (broken.length) toast(t("Missing data for: {names}", { names: broken.map((l) => l.name).join(", ") }));
  emit("projectLoaded", { name: ui.projectName, layers: flatLayers(snapshotTree()).map((l) => ({ id: l.layerId, name: l.name })) });
}

export async function newProject() {
  const root = await mountFiles([]);
  newDoc(root, emptyProject);
  opened(t("Untitled"), null);
  ui.sourceUrl = null;
  ui.panel = "add";
}

export const DEMO_URL = `${import.meta.env.BASE_URL}projects/world/world.qgz`;

async function open(name: string, load: () => Promise<{ root: string; path: string }>, storedId: string | null = null) {
  ui.phase = "loading";
  ui.status = t("Opening {name}…", { name });
  try {
    const { root, path } = await load();
    openDoc(path, root);
    ui.status = t("Loading remote layers…");
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
export async function openFiles(files: PickedFile[], dir: FileSystemDirectoryHandle | null = null, recentId?: string) {
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
    else toast(t("Drop a QGIS project (.qgs/.qgz) or data files (GeoPackage, GeoJSON, Shapefile, GeoTIFF…)."));
    return;
  }
  const project = projects.sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  let root = "";
  await open(project.data.name, async () => {
    root = await mountFiles(files);
    return { root, path: `${root}/${project.path}` };
  });
  ui.sourceUrl = null;
  if (ui.phase !== "ready") return;
  // Opened through the File System Access API: stay linked to the files, so Save writes back to them.
  if (dir || project.handle) {
    const id = await linkProject(root, project.path, ui.projectName, dir, files, recentId);
    ui.local = dir?.name ?? project.path;
    rememberLast({ kind: "local", name: ui.projectName, id });
  } else rememberLast({ kind: "local", name: ui.projectName });
}

const pickWith = async (pick: () => Promise<{ files: PickedFile[]; dir: FileSystemDirectoryHandle | null }>, recentId?: string) => {
  try {
    const { files, dir } = await pick();
    await openFiles(files, dir, recentId);
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast((e as Error).message);
  }
};

/** Opens a project folder (linked to it where the browser allows, else read through a file input). */
export const openFolder = () => (canLink ? pickWith(pickFolder) : document.getElementById("pick-folder")?.click());
export const openProjectFiles = () => (canLink ? pickWith(pickFiles) : document.getElementById("pick-files")?.click());
export const openRecentLocal = (r: LocalRecent) => pickWith(() => readRecent(r), r.id);

/** Save: back to the computer for linked projects, otherwise in the browser. */
export async function save() {
  if (ui.phase !== "ready") return;
  if (!linked()) return saveInBrowser();
  try {
    const n = await saveToDisk();
    ui.dirty = false;
    discardAutosave();
    toast(n === 1 ? t("Saved to {name}", { name: ui.local ?? "" }) : t("Saved to {name} ({n} files)", { name: ui.local ?? "", n }));
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast((e as Error).message);
  }
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
  toast(t("Saved “{name}” in this browser", { name: ui.projectName }));
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
  await open(t("shared map"), async () => {
    const { qgs, meta } = await loadPublished(ref, rev);
    if (!embedAllowed(meta)) ui.embedBlocked = meta!.allowedDomains.join(", ");
    setAllowedDomains(meta?.allowedDomains ?? []);
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
    if (!meta) return toast(t("“{name}” is no longer saved in this browser.", { name: ref.name })), false;
    await openStored(meta);
  } else {
    const recent = ref.id && (await getRecent(ref.id).catch(() => undefined));
    if (!recent) return toast(t("“{name}” was opened from local files. Save it in the browser to reopen it on launch.", { name: ref.name })), false;
    await openRecentLocal(recent);
  }
  return ui.phase === "ready";
}

/** Reopens the work found in the autosave slot (unsaved changes from a previous session). */
export async function recoverAutosave() {
  const meta = await readAutosave();
  if (!meta) return;
  const files = await loadAutosaveFiles();
  // A linked project: read its files from the computer again, with the autosaved changes on top.
  const recent = meta.localId ? await getRecent(meta.localId).catch(() => undefined) : undefined;
  if (recent) {
    const local = await readRecent(recent).catch((e) => void toast((e as Error).message));
    if (!local) return;
    const changed = new Set(files.map((f) => f.path));
    await openFiles([...local.files.filter((f) => !changed.has(f.path)), ...files.map((f) => ({ ...f, handle: local.files.find((l) => l.path === f.path)?.handle }))], local.dir, recent.id);
    for (const f of files) unsavedFiles.add(`${linked()?.root}/${f.path}`);
  } else
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
  identifyRasters(coord);
  emit("featuresIdentified", hits.map((h) => ({ layer: h.layerId, layerName: h.layerName, id: h.fid, title: h.title, attributes: Object.fromEntries(h.attributes) })));
  setHighlight(geoms);
}

/** Adds pixel values of visible GeoTIFF layers under the click (QGIS's raster identify). */
async function identifyRasters(coord: Coordinate) {
  for (const l of flatLayers(snapshotTree()).filter((l) => l.visible && l.layerType === LayerType.Raster && isGeoTiff(l.layerId!))) {
    const values = await (await pixelSampler(l.layerId!))?.(coord);
    if (!values || values.every((v) => v === null)) continue;
    ui.hits = [...ui.hits, { layerId: l.layerId!, layerName: l.name, fid: -1, title: values.length === 1 ? t("Value {value}", { value: values[0] === null ? "NULL" : +values[0].toPrecision(6) }) : t("Pixel"), attributes: values.map((v, i) => [t("Band {n}", { n: i + 1 }), v]), raster: true }];
    ui.hitAt = [coord[0], coord[1]];
  }
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
    { id: "open", label: t("Open project…"), hint: "Ctrl+O", run: openProjectFiles },
    { id: "open-folder", label: t("Open project folder…"), run: openFolder },
    { id: "demo", label: t("Open demo project"), run: openDemo },
    { id: "panel-layers", label: t("Show Layers panel"), run: () => (ui.panel = "layers") },
    { id: "panel-add", label: t("Show Add data panel"), run: () => (ui.panel = "add") },
    { id: "panel-style", label: t("Show Style panel"), run: () => (ui.panel = "style") },
    { id: "panel-tools", label: t("Show Processing tools"), run: () => (ui.panel = "tools") },
    { id: "panel-hub", label: t("Browse the QGIS Hub"), run: () => (ui.panel = "hub") },
    { id: "panel-bookmarks", label: t("Show Bookmarks"), run: () => (ui.panel = "bookmarks") },
    { id: "docs", label: t("Documentation"), run: () => window.open(`${import.meta.env.BASE_URL}docs/`, "_blank", "noopener") },
    { id: "panel-close", label: t("Close side panel"), run: () => (ui.panel = null) },
  ];
  if (ui.phase !== "ready") return base;
  const layers = flatLayers(snapshotTree());
  return [
    ...base,
    { id: "full", label: t("Zoom to full extent"), run: zoomToFull },
    { id: "view-back", label: t("Previous map view"), hint: "Alt+←", run: previousView },
    { id: "view-next", label: t("Next map view"), hint: "Alt+→", run: nextView },
    { id: "grid", label: t("Show/hide coordinate grid"), run: () => toggleGrid() },
    { id: "time", label: t("Show/hide time slider (temporal layers)"), run: () => (ui.time.active = !ui.time.active) },
    { id: "shortcuts", label: t("Keyboard shortcuts"), hint: "?", run: () => (ui.shortcuts = true) },
    { id: "undo", label: t("Undo"), hint: "Ctrl+Z", run: () => (ui.editing ? import("./editing").then((m) => m.undo()) : undoProject()) },
    { id: "redo", label: t("Redo"), hint: "Ctrl+Shift+Z", run: () => (ui.editing ? import("./editing").then((m) => m.redo()) : redoProject()) },
    { id: "project", label: t("Project properties (title, CRS)…"), run: () => (ui.dialog = "project") },
    ...(ui.local ? [{ id: "save-local", label: t("Save to {name}", { name: ui.local }), hint: "Ctrl+S", run: save }] : []),
    { id: "save", label: ui.local ? t("Save a copy in this browser") : t("Save in this browser"), hint: ui.local ? undefined : "Ctrl+S", run: saveInBrowser },
    { id: "download", label: t("Download project file (.qgz)"), run: downloadProject },
    { id: "bundle", label: t("Download project with data (.zip)"), run: downloadBundle },
    { id: "new", label: t("New empty project"), run: newProject },
    { id: "settings", label: t("Settings (open project on launch)…"), run: () => (ui.dialog = "settings") },
    { id: "add-data", label: t("Add data files…"), run: () => document.getElementById("pick-data")?.click() },
    ...PRESETS.map((p) => ({ id: `basemap-${p.name}`, label: t("Add basemap: {name}", { name: p.name }), run: () => addRemote(p, "bottom") })),
    { id: "share", label: t("Share / publish…"), run: () => (ui.dialog = "share") },
    { id: "export-image", label: t("Export map image (PNG)…"), run: () => (ui.dialog = "export") },
    { id: "measure-line", label: t("Measure distance"), run: () => import("./maptools").then((m) => m.startMeasure("line")) },
    { id: "profile", label: t("Elevation profile"), run: () => import("./profile").then((m) => m.startProfile()) },
    { id: "measure-area", label: t("Measure area"), run: () => import("./maptools").then((m) => m.startMeasure("area")) },
    { id: "legend", label: t("Show/hide legend on map"), run: () => (ui.showLegend = !ui.showLegend) },
    { id: "select-tool", label: t("Select features (click)"), run: () => (ui.mapTool = "select") },
    ...(ui.current && ui.selection[ui.current]?.length ? [{ id: "copy-features", label: t("Copy selected features"), hint: "Ctrl+C", run: () => import("./clipboard").then((m) => m.copyFeatures(ui.current!, ui.selection[ui.current!])) }] : []),
    { id: "clear-selection", label: t("Clear all selections"), run: () => import("./selection").then((m) => m.clearSelection()) },
    { id: "zoom-selection", label: t("Zoom to selection"), run: () => import("./selection").then((m) => m.zoomToSelection()) },
    { id: "maptips", label: t("Toggle map tips"), run: () => (ui.mapTips = !ui.mapTips) },
    { id: "compare", label: t("Compare layers (swipe / side by side)"), run: () => (ui.compare.active = !ui.compare.active) },
    ...(ui.editing
      ? [
          { id: "edit-stop", label: t("Stop editing (saves)"), run: () => import("./editing").then((m) => m.stopEditing()) },
          { id: "edit-paste", label: t("Paste features"), hint: "Ctrl+V", run: () => import("./clipboard").then((m) => m.pasteFeatures()) },
          { id: "edit-explode", label: t("Explode selected multipart features"), run: () => import("./editops").then((m) => m.explodeSelected()) },
          { id: "edit-undo", label: t("Undo edit"), hint: "Ctrl+Z", run: () => import("./editing").then((m) => m.undo()) },
          { id: "edit-redo", label: t("Redo edit"), hint: "Ctrl+Shift+Z", run: () => import("./editing").then((m) => m.redo()) },
          ...(["add", "modify", "delete", "move", "rotate"] as const).map((tool) => ({ id: `edit-${tool}`, label: t("Edit tool: {tool}", { tool: t({ add: N_("add feature"), modify: N_("edit vertices"), delete: N_("delete feature"), move: N_("move features"), rotate: N_("rotate features") }[tool]) }), run: () => import("./editmap").then((m) => m.setTool(tool)) })),
        ]
      : []),
    ...ALGORITHMS.map((a) => ({ id: `alg-${a.id}`, label: t("Processing: {name}", { name: t(a.name) }), hint: a.id, run: () => ((ui.panel = "tools"), (ui.pendingAlgorithm = a.id)) })),
    { id: "clear", label: t("Clear identify results"), run: clearIdentify },
    { id: "close-table", label: t("Close attribute table"), run: () => (ui.tableLayerId = null) },
    ...readBookmarks().map((b) => ({ id: `bm-${b.id}`, label: t("Go to bookmark: {name}", { name: b.name }), run: () => zoomToBookmark(b) })),
    ...layers.flatMap((l) => [
      { id: `toggle-${l.layerId}`, label: t("Toggle visibility: {name}", { name: l.name }), run: () => setVisible(l, !l.checked) },
      { id: `zoom-${l.layerId}`, label: t("Zoom to layer: {name}", { name: l.name }), run: () => { const e = engine().fullExtent([l.layerId!]); olMapRef().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [40, 40, 40, 40] }); } },
      { id: `props-${l.layerId}`, label: t("Layer properties: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.dialog = "layer-properties")) },
      { id: `style-${l.layerId}`, label: t("Style: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.panel = "style")) },
      ...(l.layerType === LayerType.Vector && l.valid
        ? [
            { id: `table-${l.layerId}`, label: t("Open attribute table: {name}", { name: l.name }), run: () => (ui.tableLayerId = l.layerId!) },
            { id: `selexpr-${l.layerId}`, label: t("Select by expression: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.dialog = "select-expression")) },
            { id: `selloc-${l.layerId}`, label: t("Select by location: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.dialog = "select-location")) },
            { id: `calc-${l.layerId}`, label: t("Field calculator: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.dialog = "field-calc")) },
            { id: `export-${l.layerId}`, label: t("Export layer: {name}", { name: l.name }), run: () => ((ui.current = l.layerId!), (ui.dialog = "export-layer")) },
            { id: `edit-${l.layerId}`, label: t("Start editing: {name}", { name: l.name }), run: () => import("./editing").then((m) => (m.canEdit(l.layerId!) ? m.startEditing(l.layerId!) : m.convertToGpkg(l.layerId!).then(() => m.startEditing(l.layerId!)))) },
          ]
        : []),
    ]),
  ];
}
