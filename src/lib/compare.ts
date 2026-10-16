import Map from "ol/Map";
import { olMap, olLayers, layerStack } from "./map";
import { ui } from "./state.svelte";

/**
 * Compare view: a second map sharing the main map's view (so pan and zoom stay in sync), showing a
 * chosen set of layers, either side by side or swiped over the main map.
 */

let map: Map | null = null;

export function createCompareMap(target: HTMLElement) {
  map = new Map({ target, controls: [], view: olMap().getView() });
  refreshCompare();
  return () => {
    map?.setTarget(undefined);
    map = null;
  };
}

/** Re-renders the comparison side (after layer or style changes). */
export function refreshCompare() {
  if (!map) return;
  map.getLayers().clear();
  map.getLayers().extend(olLayers(layerStack(new Set(ui.compare.layers))));
}

export const updateCompareSize = () => map?.updateSize();
