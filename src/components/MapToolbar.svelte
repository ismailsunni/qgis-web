<script lang="ts">
  import { startMeasure, stopTool, legendImage, startBoxTool } from "../lib/maptools";
  import { selectInExtent, modeFrom, clearSelection } from "../lib/selection";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const legend = $derived((ui.version, ui.showLegend && ui.phase === "ready" ? legendImage() : ""));
  const toggle = (tool: "measure-line" | "measure-area") => (ui.mapTool === tool ? stopTool() : startMeasure(tool === "measure-line" ? "line" : "area"));
</script>

<div class="map-toolbar" role="toolbar" aria-label="Map tools">
  <button class:active={ui.mapTool === "select"} title="Select features by clicking (Shift adds, Ctrl removes)" aria-label="Select features" onclick={() => { const on = ui.mapTool !== "select"; stopTool(); if (on) ui.mapTool = "select"; }}><Icon name="select" size={17} /></button>
  <button class:active={ui.mapTool === "select-box"} title="Select features with a rectangle (Shift adds, Ctrl removes)" aria-label="Select with rectangle" onclick={() => (ui.mapTool === "select-box" ? stopTool() : startBoxTool((extent, e) => selectInExtent(extent, modeFrom(e))))}><Icon name="selectbox" size={17} /></button>
  {#if Object.keys(ui.selection).length}
    <button title="Clear selection" aria-label="Clear selection" onclick={() => clearSelection()}><Icon name="close" size={17} /></button>
  {/if}
  <button class:active={ui.mapTool === "measure-line"} title="Measure distance" aria-label="Measure distance" onclick={() => toggle("measure-line")}><Icon name="ruler" size={17} /></button>
  <button class:active={ui.mapTool === "measure-area"} title="Measure area" aria-label="Measure area" onclick={() => toggle("measure-area")}><Icon name="area" size={17} /></button>
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
