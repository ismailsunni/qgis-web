import { readFile, modifiedFiles, exists } from "./engine";
import { hasProject, project, projectBytes, projectFiles } from "./doc";
import { writeAutosave, clearAutosave } from "./storage";
import { ui } from "./state.svelte";

/**
 * Autosave: a few seconds after unsaved changes settle, the project and the data files that
 * changed are written to a browser storage slot, so a crash or a closed tab can be recovered.
 * The first autosave of a session copies every file; later ones only what changed.
 */

let timer = 0;
let session: string | null = null;

export function scheduleAutosave() {
  clearTimeout(timer);
  if (!ui.dirty || ui.phase !== "ready" || !hasProject()) return;
  timer = window.setTimeout(() => autosaveNow().catch(() => {}), 2500);
}

export async function autosaveNow() {
  if (!ui.dirty || !hasProject() || !navigator.storage?.getDirectory) return;
  const d = project();
  const rel = (p: string) => p.slice(d.root.length + 1);
  const fresh = session !== d.root;
  let files: Record<string, Uint8Array>;
  if (fresh) files = projectFiles();
  else {
    files = { [rel(`${d.dir}/${d.file}`)]: projectBytes() };
    for (const p of modifiedFiles) if (p.startsWith(d.root + "/") && !p.endsWith(".quarkgis.qgs") && exists(p)) files[rel(p)] = readFile(p);
  }
  modifiedFiles.clear();
  await writeAutosave(
    { id: "autosave", name: ui.projectName, projectPath: rel(`${d.dir}/${d.file}`), savedAt: new Date().toISOString(), sourceUrl: ui.sourceUrl, storedId: ui.storedId },
    files,
    fresh,
  );
  session = d.root;
}

/** After an explicit save, the autosave is no longer needed. */
export async function discardAutosave() {
  clearTimeout(timer);
  session = null;
  await clearAutosave();
}
