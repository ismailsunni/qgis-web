<script lang="ts">
  import { untrack } from "svelte";
  import { LayerType } from "qgis-js";
  import { selectByLocation, type SelectMode } from "../lib/selection";
  import { flatLayers, snapshotTree } from "../lib/tree";
  import { findMapLayer } from "../lib/engine";
  import { toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let props: { layerId: string; onclose: () => void } = $props();
  const layerId = untrack(() => props.layerId);
  const others = flatLayers(snapshotTree()).filter((l) => l.valid && l.layerType === LayerType.Vector && l.layerId !== layerId);
  let other = $state(others[0]?.layerId ?? "");
  let mode = $state<SelectMode>("new");
  let busy = $state(false);

  async function run() {
    busy = true;
    try {
      const n = await selectByLocation(layerId, other, mode);
      toast(`${n.toLocaleString()} features intersect`);
      props.onclose();
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Select by location">
    <header>
      <h2>Select by location</h2>
      <button class="icon" aria-label="Close" onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <p>Select features of <b>{findMapLayer(layerId)?.name}</b> that intersect features of</p>
    <select bind:value={other}>{#each others as l}<option value={l.layerId}>{l.name}</option>{/each}</select>
    <label class="field">Selection
      <select bind:value={mode}>
        <option value="new">Create a new selection</option>
        <option value="add">Add to the current selection</option>
        <option value="remove">Remove from the current selection</option>
        <option value="intersect">Select within the current selection</option>
      </select>
    </label>
    <footer>
      <button onclick={props.onclose}>Cancel</button>
      <button class="primary" disabled={busy || !other} onclick={run}>{busy ? "Selecting…" : "Select"}</button>
    </footer>
  </div>
</div>
