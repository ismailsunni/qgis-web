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
  import { selectAt, modeFrom } from "../lib/selection";
  import { createCompareMap, refreshCompare, updateCompareSize } from "../lib/compare";
  import ComparePanel from "./ComparePanel.svelte";
  import { viewChanged } from "../lib/embed";
  import { formatCoord, FORMATS, FORMAT_LABELS } from "../lib/coords";
  import { getSettings, saveSettings } from "../lib/settings";
  import { recordView } from "../lib/navigation";
  import MapContextMenu from "./MapContextMenu.svelte";

  let target: HTMLDivElement;
  let coord = $state("");
  let scale = $state(0);
  let crs = $state("");
  let coordFormat = $state(getSettings().coords);
  let lastCoord: number[] = [0, 0];
  let tip = $state<{ html: string; x: number; y: number } | null>(null);
  let tipTimer = 0;
  let compareTarget = $state<HTMLDivElement>();
  let menu = $state<{ pixel: number[]; coordinate: number[] } | null>(null);

  // The comparison map lives while compare is on, and follows layer and style changes.
  $effect(() => {
    if (!ui.compare.active || !compareTarget) return;
    return createCompareMap(compareTarget);
  });
  $effect(() => {
    ui.version;
    ui.compare.layers;
    ui.compare.mode;
    refreshCompare();
    requestAnimationFrame(updateCompareSize);
  });

  // Swipe: the comparison map sits underneath; only the main map's layer canvas is clipped,
  // so its controls stay usable.
  $effect(() => {
    const clip = ui.compare.active && ui.compare.mode === "swipe" ? `inset(0 ${100 - ui.compare.x}% 0 0)` : "";
    const layers = target?.querySelector<HTMLElement>(".ol-layers");
    if (layers) layers.style.clipPath = clip;
  });

  function dragDivider(e: PointerEvent) {
    const area = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const move = (ev: PointerEvent) => (ui.compare.x = Math.min(98, Math.max(2, ((ev.clientX - area.left) / area.width) * 100)));
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  onMount(() => {
    const map = createMap(target, true);
    map.on("singleclick", (e) => {
      if (ui.phase !== "ready") return;
      if (ui.mapTool === "select") return selectAt(e.coordinate, modeFrom(e.originalEvent as MouseEvent));
      if (ui.mapTool !== "identify") return;
      if (ui.editing && editClick(e.coordinate)) return;
      identifyAt(e.coordinate);
    });
    map.on("pointermove", (e) => {
      if (ui.phase !== "ready" || e.dragging) return;
      lastCoord = e.coordinate;
      coord = formatCoord(coordFormat, e.coordinate, coordFormat === "project" ? null : projectToLonLat(e.coordinate));
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
      viewChanged();
      recordView();
      scale = scaleDenominator();
      crs = srid();
    });
    target.addEventListener("contextmenu", (e) => {
      if (ui.phase !== "ready" || ui.mapTool !== "identify") return;
      e.preventDefault();
      const pixel = map.getEventPixel(e);
      menu = { pixel, coordinate: map.getCoordinateFromPixel(pixel) };
    });
    const ro = new ResizeObserver(() => map.updateSize());
    ro.observe(target);
    return () => ro.disconnect();
  });
</script>

<div class="map" class:half={ui.compare.active && ui.compare.mode === "side"} class:swiping={ui.compare.active && ui.compare.mode === "swipe"} bind:this={target}></div>

{#if ui.compare.active}
  <div
    class="map compare-map {ui.compare.mode}"
    bind:this={compareTarget}
    style:clip-path={ui.compare.mode === "swipe" ? `inset(0 0 0 ${ui.compare.x}%)` : undefined}
  ></div>
  {#if ui.compare.mode === "swipe"}
    <div class="swipe-divider" style:left="{ui.compare.x}%" role="separator" aria-label="Swipe divider" onpointerdown={dragDivider}><span></span></div>
  {/if}
  <ComparePanel />
{/if}

{#if ui.phase === "ready"}
  {#if !view.mapOnly}<SearchBox />{/if}
  <MapToolbar />
{/if}

{#if tip}
  <!-- Map tips are project HTML: shown in a sandboxed frame, so scripts never run. -->
  <iframe class="map-tip" title="Map tip" sandbox="" srcdoc={`<style>body{margin:6px;font:12px system-ui}</style>${tip.html}`} style:left="{tip.x + 14}px" style:top="{tip.y + 14}px"></iframe>
{/if}

{#if menu}<MapContextMenu at={menu} onclose={() => (menu = null)} />{/if}

{#if ui.editing && !view.mapOnly}<EditToolbar />{/if}

{#if ui.hits.length}
  <IdentifyResults onclose={clearIdentify} />
{/if}

{#if ui.phase === "ready" && !view.mapOnly}
  <div class="statusbar">
    <button class="coord" title="{FORMAT_LABELS[coordFormat]}: click for another format" onclick={() => {
      coordFormat = FORMATS[(FORMATS.indexOf(coordFormat) + 1) % FORMATS.length];
      saveSettings({ coords: coordFormat });
      coord = formatCoord(coordFormat, lastCoord, coordFormat === "project" ? null : projectToLonLat(lastCoord));
    }}>{coord || FORMAT_LABELS[coordFormat]}</button>
    <span>1:{Math.round(scale).toLocaleString()}</span>
    <span>{crs}</span>
  </div>
{/if}
