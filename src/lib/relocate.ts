import { hasProject, missingData, layerSource, mapLayerEl, project, findChild, reload, layerIds } from "./doc";
import { exists, unsavedFiles, writeFile } from "./engine";
import { redraw } from "./map";
import { linked, rememberRelocation, type PickedFile } from "./localfs";
import { changed } from "./state.svelte";

/**
 * QGIS's "Handle Unavailable Layers": layers whose files can't be found are pointed at files the
 * user locates. Only QGIS's copy of the project is changed; the project keeps its original paths.
 */

export interface Unavailable { id: string; name: string; path: string; file: string }

const stem = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();
const base = (path: string) => path.split(/[\\/]/).pop()!;

/** Path part of a data source as written in the project (no layer name or options). */
function sourcePath(datasource: string, provider: string) {
  return provider === "delimitedtext" ? datasource.replace(/^file:(\/\/)?/, "").split("?")[0] : datasource.split("|")[0].replace(/^GPKG:(.*):[^:]+$/, "$1");
}

export function unavailableLayers(): Unavailable[] {
  if (!hasProject()) return [];
  return layerIds().flatMap((id) => {
    if (!missingData(id)) return [];
    const { datasource, provider } = layerSource(id);
    const path = decodeURIComponent(sourcePath(datasource, provider));
    return [{ id, name: findChild(mapLayerEl(id)!, "layername")?.textContent ?? id, path, file: base(path) }];
  });
}

/** Points a layer at a located file (plus its sidecars, e.g. a Shapefile's .dbf/.shx/.prj). */
export async function relocate(id: string, files: PickedFile[]) {
  const d = project();
  const { datasource, provider } = layerSource(id);
  const wanted = base(decodeURIComponent(sourcePath(datasource, provider))).toLowerCase();
  const main = files.find((f) => base(f.path).toLowerCase() === wanted) ?? files[0];
  // One copy per located file, shared by the layers reading it (e.g. tables of one GeoPackage).
  const dir = `${d.root}/.relocated/${main.data.size}-${main.data.lastModified}`;
  for (const f of files.filter((f) => f === main || stem(base(f.path)) === stem(base(main.path)))) {
    const target = `${dir}/${base(f.path)}`;
    if (!exists(target)) writeFile(target, new Uint8Array(await f.data.arrayBuffer()));
    // Only edits need writing back, not the file as read.
    unsavedFiles.delete(target);
    if (f.handle && linked()) linked()!.files[target.slice(linked()!.root.length + 1)] = f.handle;
  }
  const path = `${dir}/${base(main.path)}`;
  const original = sourcePath(datasource, provider);
  d.local[id] = { datasource: datasource.replace(original, path), provider, relocated: true };
  await rememberRelocation(id, files.filter((f) => f === main || stem(base(f.path)) === stem(base(main.path))));
}

/** Applies relocations, then reloads the project in QGIS. */
export async function relocateAll(found: [string, PickedFile[]][]) {
  for (const [id, files] of found) await relocate(id, files);
  reload();
  changed();
  redraw();
  return found.length;
}

/** Finds the missing files in a folder (and its subfolders) by name. */
export function matchInFolder(files: PickedFile[]): [string, PickedFile[]][] {
  return unavailableLayers().flatMap((u): [string, PickedFile[]][] => {
    const tail = u.path.replace(/\\/g, "/").toLowerCase().split("/").filter((p) => p && p !== "." && p !== "..");
    const hits = files.filter((f) => base(f.path).toLowerCase() === u.file.toLowerCase());
    // Prefer the file whose folders match the end of the original path.
    const score = (f: PickedFile) => { const p = f.path.toLowerCase().split("/"); let n = 0; while (n < Math.min(p.length, tail.length) && p[p.length - 1 - n] === tail[tail.length - 1 - n]) n++; return n; };
    const best = hits.sort((a, b) => score(b) - score(a))[0];
    if (!best) return [];
    const folder = best.path.slice(0, best.path.length - base(best.path).length);
    return [[u.id, files.filter((f) => f.path.startsWith(folder) && !f.path.slice(folder.length).includes("/") && stem(base(f.path)) === stem(u.file))]];
  });
}
