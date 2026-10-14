<script lang="ts">
  import { onMount } from "svelte";
  import { createMap, scaleDenominator, srid } from "../lib/map";
  import { clearIdentify, identifyAt } from "../lib/actions";
  import { ui, view } from "../lib/state.svelte";
  import IdentifyResults from "./IdentifyResults.svelte";

  let target: HTMLDivElement;
  let coord = $state("");
  let scale = $state(0);
  let crs = $state("");

  onMount(() => {
    const map = createMap(target, true);
    map.on("singleclick", (e) => ui.phase === "ready" && identifyAt(e.coordinate));
    map.on("pointermove", (e) => {
      if (ui.phase !== "ready" || e.dragging) return;
      const [x, y] = e.coordinate;
      const digits = Math.abs(x) < 400 && Math.abs(y) < 400 ? 5 : 1;
      coord = `${x.toFixed(digits)}, ${y.toFixed(digits)}`;
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

{#if ui.hits.length}
  <IdentifyResults onclose={clearIdentify} />
{/if}

{#if ui.phase === "ready" && !view.mapOnly}
  <div class="statusbar">
    <span title="Coordinates in project CRS">{coord}</span>
    <span>1:{Math.round(scale).toLocaleString()}</span>
    <span>{crs}</span>
  </div>
{/if}
