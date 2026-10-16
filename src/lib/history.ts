import { project, reload, serialize, setXml } from "./doc";
import { redraw } from "./map";
import { ui, changed, toast } from "./state.svelte";

/**
 * Undo/redo for project changes (styles, layer tree, layers, bookmarks…). Every change goes
 * through the project document, so history is a stack of document snapshots. Feature edits
 * have their own undo in the edit session.
 */

const LIMIT = 50;
let past: { xml: string; label: string }[] = [];
let future: { xml: string; label: string }[] = [];

function sync() {
  ui.canUndoProject = past.length > 0;
  ui.canRedoProject = future.length > 0;
}

/** Records the document before a change. */
export function snapshot(label = "change") {
  past.push({ xml: serialize(), label });
  if (past.length > LIMIT) past.shift();
  future = [];
  sync();
}

export function resetHistory() {
  past = [];
  future = [];
  sync();
}

function restore(xml: string) {
  setXml(xml);
  reload();
  ui.dirty = true;
  changed();
  redraw();
}

export function undoProject() {
  const step = past.pop();
  if (!step) return;
  future.push({ xml: serialize(), label: step.label });
  restore(step.xml);
  sync();
  toast(`Undid ${step.label}`);
}

export function redoProject() {
  const step = future.pop();
  if (!step) return;
  past.push({ xml: serialize(), label: step.label });
  restore(step.xml);
  sync();
  toast(`Redid ${step.label}`);
}
