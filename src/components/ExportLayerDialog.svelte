<script lang="ts">
  import { untrack } from "svelte";
  import { exportLayer, type ExportFormat } from "../lib/export";
  import { findMapLayer } from "../lib/engine";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

  let props: { layerId: string; onclose: () => void } = $props();
  const layerId = untrack(() => props.layerId);
  const name = findMapLayer(layerId)?.name;
  const count = (ui.selection[layerId] ?? []).length;
  let format = $state<ExportFormat>("gpkg");
  let onlySelected = $state(count > 0);
  let busy = $state(false);

  async function run() {
    busy = true;
    try {
      await exportLayer(layerId, format, onlySelected ? ui.selection[layerId] : undefined);
      props.onclose();
    } catch (e) {
      toast(t("Export failed: {message}", { message: (e as Error).message }));
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Export layer")}>
    <header>
      <h2>{t("Export {name}", { name: name ?? "" })}</h2>
      <button class="icon" aria-label={t("Close")} onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <label class="field">{t("Format")}
      <select bind:value={format}>
        <option value="gpkg">{t("GeoPackage (.gpkg), in the layer's CRS")}</option>
        <option value="geojson">{t("GeoJSON (.geojson), in WGS 84")}</option>
        <option value="csv">{t("CSV with WKT geometry (.csv), in the layer's CRS")}</option>
        <option value="fgb">{t("FlatGeobuf (.fgb), in the layer's CRS")}</option>
        <option value="shp">{t("Shapefile (.zip), in WGS 84")}</option>
        <option value="kml">{t("KML (.kml), in WGS 84")}</option>
      </select>
    </label>
    {#if count}<label class="field row-inline"><input type="checkbox" bind:checked={onlySelected} /> {t("Selected features only ({n})", { n: count })}</label>{/if}
    <footer>
      <button onclick={props.onclose}>{t("Cancel")}</button>
      <button class="primary" disabled={busy} onclick={run}>{busy ? t("Exporting…") : t("Export")}</button>
    </footer>
  </div>
</div>
