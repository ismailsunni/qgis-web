import { reload } from "./doc";
import { snapshot } from "./history";
import { redraw } from "./map";
import { ui, changed, toast } from "./state.svelte";

/**
 * Applies an edit to the project document, then reloads it in QGIS and re-renders.
 * The previous document is kept for undo, under `label`.
 */
export function apply(edit: () => void, label = "change") {
  try {
    snapshot(label);
    edit();
    reload();
    ui.dirty = true;
  } catch (e) {
    toast((e as Error).message);
  }
  changed();
  redraw();
}
