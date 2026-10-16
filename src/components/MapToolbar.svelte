<script lang="ts">
  import { startMeasure, stopTool, legendImage, startBoxTool, startShapeTool } from "../lib/maptools";
  import { selectInExtent, selectInPolygon, modeFrom, clearSelection } from "../lib/selection";
  import { startProfile } from "../lib/profile";
  import { previousView, nextView, toggleGrid } from "../lib/navigation";
  import { temporalLayers } from "../lib/temporal";

  let selectMenu = $state(false);
  const SELECT_TOOLS = [
    ["select", "Click", "select"],
    ["select-box", "Rectangle", "selectbox"],
    ["select-polygon", "Polygon", "area"],
    ["select-freehand", "Freehand", "lasso"],
  ] as const;
  const activeSelect = $derived(SELECT_TOOLS.find(([t]) => t === ui.mapTool));

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

<div class="map-toolbar" role="toolbar" aria-label="Map tools">
  <div class="tool-group">
    <button title="Previous view (Alt+←)" aria-label="Previous view" disabled={!ui.viewHistory[0]} onclick={previousView}><Icon name="back" size={17} /></button>
    <button title="Next view (Alt+→)" aria-label="Next view" disabled={!ui.viewHistory[1]} onclick={nextView}><Icon name="forward" size={17} /></button>
  </div>
  <div class="tool-group">
    <button class:active={!!activeSelect} title="Select features (Shift adds, Ctrl removes)" aria-label="Select features" onclick={() => (activeSelect ? stopTool() : startSelect("select"))}><Icon name={activeSelect?.[2] ?? "select"} size={17} /></button>
    <button class="more" title="Selection tools" aria-label="Selection tools" onclick={() => (selectMenu = !selectMenu)}>▾</button>
    {#if selectMenu}
      <div class="menu card tool-menu" role="menu">
        {#each SELECT_TOOLS as [tool, label, icon]}
          <button role="menuitem" class:active={ui.mapTool === tool} onclick={() => startSelect(tool)}><Icon name={icon} size={15} /> Select by {label.toLowerCase()}</button>
        {/each}
      </div>
    {/if}
  </div>
  {#if Object.keys(ui.selection).length}
    <button title="Clear selection" aria-label="Clear selection" onclick={() => clearSelection()}><Icon name="close" size={17} /></button>
  {/if}
  <button class:active={ui.mapTool === "measure-line"} title="Measure distance" aria-label="Measure distance" onclick={() => toggle("measure-line")}><Icon name="ruler" size={17} /></button>
  <button class:active={ui.mapTool === "measure-area"} title="Measure area" aria-label="Measure area" onclick={() => toggle("measure-area")}><Icon name="area" size={17} /></button>
  <button class:active={ui.mapTool === "profile"} title="Elevation profile (needs an elevation raster)" aria-label="Elevation profile" onclick={() => (ui.mapTool === "profile" ? stopTool() : startProfile())}><Icon name="profile" size={17} /></button>
  {#if (ui.version, temporalLayers().length)}
    <button class:active={ui.time.active} title="Time slider (temporal controller)" aria-label="Time slider" onclick={() => (ui.time.active = !ui.time.active)}><Icon name="clock" size={17} /></button>
  {/if}
  <button class:active={ui.grid} title="Coordinate grid" aria-label="Coordinate grid" onclick={() => toggleGrid()}><Icon name="grid" size={17} /></button>
  <button class:active={ui.showLegend} title="Legend" aria-label="Legend" onclick={() => (ui.showLegend = !ui.showLegend)}><Icon name="legend" size={17} /></button>
  <button class:active={ui.mapTips} title="Map tips on hover" aria-label="Map tips" onclick={() => (ui.mapTips = !ui.mapTips)}><Icon name="tip" size={17} /></button>
  <button class:active={ui.compare.active} title="Compare (swipe or side by side)" aria-label="Compare" onclick={() => (ui.compare.active = !ui.compare.active)}><Icon name="compare" size={17} /></button>
  <button title="Export map image" aria-label="Export map image" onclick={() => (ui.dialog = "export")}><Icon name="image" size={17} /></button>
</div>

{#if ui.measure}
  <div class="measure-readout" role="status">
    <span>{ui.measure}</span>
    <button class="icon" aria-label="Stop measuring" onclick={stopTool}><Icon name="close" size={14} /></button>
  </div>
{/if}

{#if legend}
  <!-- Rendered at device resolution, shown at CSS size. -->
  <div class="map-legend card"><img src={legend} alt="Legend" onload={(e) => { const img = e.currentTarget as HTMLImageElement; img.style.width = `${img.naturalWidth / Math.min(2, devicePixelRatio || 1)}px`; }} /></div>
{/if}
