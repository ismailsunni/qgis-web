import { reload } from "./doc";
import { redraw } from "./map";
import { ui, changed, toast } from "./state.svelte";

/** Applies an edit to the project document, then reloads it in QGIS and re-renders. */
export function apply(edit: () => void) {
  try {
    edit();
    reload();
    ui.dirty = true;
  } catch (e) {
    toast((e as Error).message);
  }
  changed();
  redraw();
}
