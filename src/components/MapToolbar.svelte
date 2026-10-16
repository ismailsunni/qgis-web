<script lang="ts">
  import { startMeasure, stopTool, legendImage } from "../lib/maptools";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const legend = $derived((ui.version, ui.showLegend && ui.phase === "ready" ? legendImage() : ""));
  const toggle = (tool: "measure-line" | "measure-area") => (ui.mapTool === tool ? stopTool() : startMeasure(tool === "measure-line" ? "line" : "area"));
</script>

<div class="map-toolbar" role="toolbar" aria-label="Map tools">
  <button class:active={ui.mapTool === "measure-line"} title="Measure distance" aria-label="Measure distance" onclick={() => toggle("measure-line")}><Icon name="ruler" size={17} /></button>
  <button class:active={ui.mapTool === "measure-area"} title="Measure area" aria-label="Measure area" onclick={() => toggle("measure-area")}><Icon name="area" size={17} /></button>
  <button class:active={ui.showLegend} title="Legend" aria-label="Legend" onclick={() => (ui.showLegend = !ui.showLegend)}><Icon name="legend" size={17} /></button>
  <button class:active={ui.mapTips} title="Map tips on hover" aria-label="Map tips" onclick={() => (ui.mapTips = !ui.mapTips)}><Icon name="tip" size={17} /></button>
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
  <div class="map-legend card"><img src={legend} alt="Legend" onload={(e) => (e.currentTarget.style.width = `${e.currentTarget.naturalWidth / Math.min(2, devicePixelRatio || 1)}px`)} /></div>
{/if}
