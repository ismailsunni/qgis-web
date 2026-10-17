<script lang="ts">
  import { onMount } from "svelte";
  import { ui } from "../lib/state.svelte";
  import { t, N_ } from "../lib/i18n";
  import { finishTour } from "../lib/tour";

  /** A short guided tour of the main parts of the app (shown once, restartable from the action search). */
  const STEPS: { target?: string; panel?: "layers" | "add"; title: string; text: string }[] = [
    { title: N_("Welcome to QuarkGIS"), text: N_("Real QGIS projects in your browser: what you see is what QGIS Desktop draws, and what you save opens there unchanged. Here is a quick look around.") },
    { target: "layer-tree", panel: "layers", title: N_("Layers"), text: N_("Switch layers on and off, drag to reorder, click one to make it current. Right-click a layer for its menu and properties.") },
    { target: "add", panel: "add", title: N_("Add data"), text: N_("Drop files, connect web services, pick a basemap, or browse open data catalogs for imagery and public datasets.") },
    { target: "style", title: N_("Style, table, tools"), text: N_("Style the current layer, open its attribute table, run processing tools, keep bookmarks, and apply styles from the QGIS Hub.") },
    { target: "map-tools", title: N_("Map tools"), text: N_("Select, measure, draw elevation profiles, show your location, add a grid, the legend, compare layers, and export a PNG or a PDF map.") },
    { target: "search", title: N_("Search every action"), text: N_("Press Ctrl+K (⌘K) to find any command or layer by name. Press ? for the keyboard shortcuts.") },
    { target: "save", title: N_("Save"), text: N_("Projects opened from your computer save back to their own files, like in QGIS Desktop. You can also keep a copy in the browser or download it.") },
    { target: "share", title: N_("Share"), text: N_("Publish a link anyone can open, at the current view, or embed the map in a web page.") },
    { target: "status", title: N_("Where you are"), text: N_("Pointer coordinates (click to change the format), the scale and the project's CRS. Right-click the map to copy a position or link to this view.") },
  ];

  let step = $state(0);
  let rect = $state<DOMRect | null>(null);
  const current = $derived(STEPS[step]);

  function measure() {
    const el = current.target ? document.querySelector(`[data-tour="${current.target}"]`) : null;
    rect = el?.getBoundingClientRect() ?? null;
  }
  $effect(() => {
    if (current.panel) ui.panel = current.panel;
    // Measure once the panel has opened.
    requestAnimationFrame(measure);
  });
  onMount(() => {
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  });

  // The card goes beside the highlighted area, inside the window.
  const card = $derived.by(() => {
    if (!rect) return "left:50%;top:50%;transform:translate(-50%,-50%)";
    const w = 320, pad = 12;
    const right = rect.right + pad + w < innerWidth;
    const below = rect.bottom + 180 < innerHeight;
    if (rect.width < innerWidth / 2 && (right || rect.left > w + pad)) return `top:${Math.min(Math.max(rect.top, pad), innerHeight - 220)}px;${right ? `left:${rect.right + pad}px` : `left:${rect.left - w - pad}px`}`;
    return `left:${Math.min(Math.max(rect.left, pad), innerWidth - w - pad)}px;${below ? `top:${rect.bottom + pad}px` : `top:${rect.top - 200 - pad}px`}`;
  });

  const done = () => finishTour();
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") done(); if (e.key === "ArrowRight" && step < STEPS.length - 1) step++; if (e.key === "ArrowLeft" && step > 0) step--; }} />

<div class="tour" role="dialog" aria-modal="true" aria-label={t("Tour")}>
  {#if rect}
    <div class="tour-spot" style:left="{rect.left - 4}px" style:top="{rect.top - 4}px" style:width="{rect.width + 8}px" style:height="{rect.height + 8}px"></div>
  {:else}
    <div class="tour-dim"></div>
  {/if}
  <div class="tour-card card" style={card}>
    <span class="muted">{step + 1} / {STEPS.length}</span>
    <h3>{t(current.title)}</h3>
    <p>{t(current.text)}</p>
    <div class="row">
      <button class="link" onclick={done}>{t("Skip the tour")}</button>
      <span class="spacer"></span>
      {#if step > 0}<button onclick={() => step--}>{t("Back")}</button>{/if}
      {#if step < STEPS.length - 1}
        <button class="primary" onclick={() => step++}>{t("Next")}</button>
      {:else}
        <button class="primary" onclick={done}>{t("Done")}</button>
      {/if}
    </div>
  </div>
</div>
