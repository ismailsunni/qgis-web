import { ui } from "./state.svelte";

/** The welcome tour: shown the first time a project opens (not in embeds or automated browsers). */
const KEY = "quarkgis:tour-done";

export function maybeStartTour() {
  if (localStorage.getItem(KEY) || navigator.webdriver || window.top !== window) return;
  ui.tour = true;
}

export const startTour = () => (ui.tour = true);

export function finishTour() {
  ui.tour = false;
  localStorage.setItem(KEY, "1");
}
