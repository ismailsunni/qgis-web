<script lang="ts">
  import { startMeasure, stopTool, legendImage, startBoxTool, startShapeTool } from "../lib/maptools";
  import { selectInExtent, selectInPolygon, modeFrom, clearSelection } from "../lib/selection";
  import { startProfile } from "../lib/profile";
  import { previousView, nextView, toggleGrid } from "../lib/navigation";
  import { temporalLayers } from "../lib/temporal";
  import { t, N_ } from "../lib/i18n";

  let selectMenu = $state(false);
  const SELECT_TOOLS = [
    ["select", N_("Select by click"), "select"],
    ["select-box", N_("Select by rectangle"), "selectbox"],
    ["select-polygon", N_("Select by polygon"), "area"],
    ["select-freehand", N_("Select by freehand"), "lasso"],
  ] as const;
  const activeSelect = $derived(SELECT_TOOLS.find(([tool]) => tool === ui.mapTool));

  function startSelect(tool: (typeof SELECT_TOOLS)[number][0]) {
    selectMenu = false;
    if (ui.mapTool === tool) return stopTool();
    if (tool === "select") (stopTool(), (ui.mapTool = "select"));
    else if (tool === "select-box") startBoxTool((extent, e) => selectInExtent(extent, modeFrom(e)));
    else startShapeTool(tool === "select-freehand", (g, e) => selectInPolygon(g, modeFrom(e)));
  }
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const legend = $derived((ui.version, ui.showLegend && ui.phase === "ready" ? legendImage() : ""));
  const toggle = (tool: "measure-line" | "measure-area") => (ui.mapTool === tool ? stopTool() : startMeasure(tool === "measure-line" ? "line" : "area"));
</script>

<div class="map-toolbar" role="toolbar" aria-label={t("Map tools")}>
  <div class="tool-group">
    <button title={t("Previous view (Alt+←)")} aria-label={t("Previous view")} disabled={!ui.viewHistory[0]} onclick={previousView}><Icon name="back" size={17} /></button>
    <button title={t("Next view (Alt+→)")} aria-label={t("Next view")} disabled={!ui.viewHistory[1]} onclick={nextView}><Icon name="forward" size={17} /></button>
  </div>
  <div class="tool-group">
    <button class:active={!!activeSelect} title={t("Select features (Shift adds, Ctrl removes)")} aria-label={t("Select features")} onclick={() => (activeSelect ? stopTool() : startSelect("select"))}><Icon name={activeSelect?.[2] ?? "select"} size={17} /></button>
    <button class="more" title={t("Selection tools")} aria-label={t("Selection tools")} onclick={() => (selectMenu = !selectMenu)}>▾</button>
    {#if selectMenu}
      <div class="menu card tool-menu" role="menu">
        {#each SELECT_TOOLS as [tool, label, icon]}
          <button role="menuitem" class:active={ui.mapTool === tool} onclick={() => startSelect(tool)}><Icon name={icon} size={15} /> {t(label)}</button>
        {/each}
      </div>
    {/if}
  </div>
  {#if Object.keys(ui.selection).length}
    <button title={t("Clear selection")} aria-label={t("Clear selection")} onclick={() => clearSelection()}><Icon name="close" size={17} /></button>
  {/if}
  <button class:active={ui.mapTool === "measure-line"} title={t("Measure distance")} aria-label={t("Measure distance")} onclick={() => toggle("measure-line")}><Icon name="ruler" size={17} /></button>
  <button class:active={ui.mapTool === "measure-area"} title={t("Measure area")} aria-label={t("Measure area")} onclick={() => toggle("measure-area")}><Icon name="area" size={17} /></button>
  <button class:active={ui.mapTool === "profile"} title={t("Elevation profile (needs an elevation raster)")} aria-label={t("Elevation profile")} onclick={() => (ui.mapTool === "profile" ? stopTool() : startProfile())}><Icon name="profile" size={17} /></button>
  {#if (ui.version, temporalLayers().length)}
    <button class:active={ui.time.active} title={t("Time slider (temporal controller)")} aria-label={t("Time slider")} onclick={() => (ui.time.active = !ui.time.active)}><Icon name="clock" size={17} /></button>
  {/if}
  <button class:active={ui.grid} title={t("Coordinate grid")} aria-label={t("Coordinate grid")} onclick={() => toggleGrid()}><Icon name="grid" size={17} /></button>
  <button class:active={ui.showLegend} title={t("Legend")} aria-label={t("Legend")} onclick={() => (ui.showLegend = !ui.showLegend)}><Icon name="legend" size={17} /></button>
  <button class:active={ui.mapTips} title={t("Map tips on hover")} aria-label={t("Map tips")} onclick={() => (ui.mapTips = !ui.mapTips)}><Icon name="tip" size={17} /></button>
  <button class:active={ui.compare.active} title={t("Compare (swipe or side by side)")} aria-label={t("Compare")} onclick={() => (ui.compare.active = !ui.compare.active)}><Icon name="compare" size={17} /></button>
  <button title={t("Export map image")} aria-label={t("Export map image")} onclick={() => (ui.dialog = "export")}><Icon name="image" size={17} /></button>
</div>

{#if ui.measure}
  <div class="measure-readout" role="status">
    <span>{ui.measure}</span>
    <button class="icon" aria-label={t("Stop measuring")} onclick={stopTool}><Icon name="close" size={14} /></button>
  </div>
{/if}

{#if legend}
  <!-- Rendered at device resolution, shown at CSS size. -->
  <div class="map-legend card"><img src={legend} alt={t("Legend")} onload={(e) => { const img = e.currentTarget as HTMLImageElement; img.style.width = `${img.naturalWidth / Math.min(2, devicePixelRatio || 1)}px`; }} /></div>
{/if}
