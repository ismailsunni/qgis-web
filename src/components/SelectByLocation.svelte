<script lang="ts">
  import { untrack } from "svelte";
  import { LayerType } from "qgis-js";
  import { selectByLocation, type SelectMode } from "../lib/selection";
  import { flatLayers, snapshotTree } from "../lib/tree";
  import { findMapLayer } from "../lib/engine";
  import { toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

  let props: { layerId: string; onclose: () => void } = $props();
  const layerId = untrack(() => props.layerId);
  const others = flatLayers(snapshotTree()).filter((l) => l.valid && l.layerType === LayerType.Vector && l.layerId !== layerId);
  let other = $state(others[0]?.layerId ?? "");
  let mode = $state<SelectMode>("new");
  let busy = $state(false);
  const [before, after] = t("Select features of {layer} that intersect features of").split("{layer}");

  async function run() {
    busy = true;
    try {
      const n = await selectByLocation(layerId, other, mode);
      toast(t("{n} features intersect", { n: n.toLocaleString() }));
      props.onclose();
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Select by location")}>
    <header>
      <h2>{t("Select by location")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <p>{before}<b>{findMapLayer(layerId)?.name}</b>{after}</p>
    <select bind:value={other}>{#each others as l}<option value={l.layerId}>{l.name}</option>{/each}</select>
    <label class="field">{t("Selection")}
      <select bind:value={mode}>
        <option value="new">{t("Create a new selection")}</option>
        <option value="add">{t("Add to the current selection")}</option>
        <option value="remove">{t("Remove from the current selection")}</option>
        <option value="intersect">{t("Select within the current selection")}</option>
      </select>
    </label>
    <footer>
      <button onclick={props.onclose}>{t("Cancel")}</button>
      <button class="primary" disabled={busy || !other} onclick={run}>{busy ? t("Selecting…") : t("Select")}</button>
    </footer>
  </div>
</div>
