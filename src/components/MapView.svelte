<script lang="ts">
  import { onMount } from "svelte";
  import { createMap, scaleDenominator, srid } from "../lib/map";
  import { clearIdentify, identifyAt } from "../lib/actions";
  import { ui, view } from "../lib/state.svelte";
  import IdentifyResults from "./IdentifyResults.svelte";
  import EditToolbar from "./EditToolbar.svelte";
  import { editClick } from "../lib/editmap";
  import MapToolbar from "./MapToolbar.svelte";
  import SearchBox from "./SearchBox.svelte";
  import { mapTipAt, projectToLonLat } from "../lib/maptools";

  let target: HTMLDivElement;
  let coord = $state("");
  let scale = $state(0);
  let crs = $state("");
  let lonlat = $state("");
  let tip = $state<{ html: string; x: number; y: number } | null>(null);
  let tipTimer = 0;

  onMount(() => {
    const map = createMap(target, true);
    map.on("singleclick", (e) => {
      if (ui.phase !== "ready" || ui.mapTool !== "identify") return;
      if (ui.editing && editClick(e.coordinate)) return;
      identifyAt(e.coordinate);
    });
    map.on("pointermove", (e) => {
      if (ui.phase !== "ready" || e.dragging) return;
      const [x, y] = e.coordinate;
      const digits = Math.abs(x) < 400 && Math.abs(y) < 400 ? 5 : 1;
      coord = `${x.toFixed(digits)}, ${y.toFixed(digits)}`;
      const ll = digits === 1 ? projectToLonLat(e.coordinate) : null;
      lonlat = ll ? `${ll[1].toFixed(5)}, ${ll[0].toFixed(5)}` : "";
      // Map tips: after the pointer rests, show what QGIS's map tip says about the feature.
      clearTimeout(tipTimer);
      tip = null;
      if (ui.mapTips && ui.mapTool === "identify") {
        tipTimer = window.setTimeout(() => {
          const html = mapTipAt(e.coordinate);
          tip = html ? { html, x: e.pixel[0], y: e.pixel[1] } : null;
        }, 350);
      }
    });
    map.on("moveend", () => {
      if (ui.phase !== "ready") return;
      scale = scaleDenominator();
      crs = srid();
    });
    const ro = new ResizeObserver(() => map.updateSize());
    ro.observe(target);
    return () => ro.disconnect();
  });
</script>

<div class="map" bind:this={target}></div>

{#if ui.phase === "ready"}
  {#if !view.mapOnly}<SearchBox />{/if}
  <MapToolbar />
{/if}

{#if tip}
  <!-- Map tips are project HTML: shown in a sandboxed frame, so scripts never run. -->
  <iframe class="map-tip" title="Map tip" sandbox="" srcdoc={`<style>body{margin:6px;font:12px system-ui}</style>${tip.html}`} style:left="{tip.x + 14}px" style:top="{tip.y + 14}px"></iframe>
{/if}

{#if ui.editing && !view.mapOnly}<EditToolbar />{/if}

{#if ui.hits.length}
  <IdentifyResults onclose={clearIdentify} />
{/if}

{#if ui.phase === "ready" && !view.mapOnly}
  <div class="statusbar">
    {#if lonlat}<span title="Latitude, longitude">{lonlat}</span>{/if}
    <span title="Coordinates in project CRS">{coord}</span>
    <span>1:{Math.round(scale).toLocaleString()}</span>
    <span>{crs}</span>
  </div>
{/if}
