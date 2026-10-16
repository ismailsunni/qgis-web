<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import type { CsvOptions } from "../lib/csv";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

  const p = ui.csvPrompt!;
  let o = $state<CsvOptions>({ ...p.guess, crs: p.guess.crs || "EPSG:4326" });

  function done(result: CsvOptions | null) {
    ui.csvPrompt = null;
    p.resolve(result);
  }
</script>

<div class="overlay modal" role="presentation">
  <div class="dialog card csv" role="dialog" aria-modal="true" aria-label={t("Delimited text")}>
    <header>
      <h2>{t("Add {name}", { name: p.name })}</h2>
      <button class="icon" aria-label={t("Skip")} onclick={() => done(null)}><Icon name="close" size={18} /></button>
    </header>
    <div class="grid2">
      <label class="field">{t("Delimiter")}
        <select bind:value={o.delimiter}><option value=",">{t("Comma")}</option><option value=";">{t("Semicolon")}</option><option value={"\t"}>{t("Tab")}</option><option value="|">{t("Pipe")}</option></select>
      </label>
      <label class="field">{t("Geometry")}
        <select bind:value={o.geometry}><option value="xy">{t("Point coordinates")}</option><option value="wkt">{t("WKT column")}</option><option value="none">{t("No geometry (table)")}</option></select>
      </label>
      {#if o.geometry === "xy"}
        <label class="field">{t("X / longitude")}<select bind:value={o.x}>{#each p.columns as c}<option>{c}</option>{/each}</select></label>
        <label class="field">{t("Y / latitude")}<select bind:value={o.y}>{#each p.columns as c}<option>{c}</option>{/each}</select></label>
      {:else if o.geometry === "wkt"}
        <label class="field">{t("WKT column")}<select bind:value={o.wkt}>{#each p.columns as c}<option>{c}</option>{/each}</select></label>
      {/if}
      {#if o.geometry !== "none"}
        <label class="field">CRS<input list="csv-crs" bind:value={o.crs} placeholder="EPSG:4326" /></label>
        <datalist id="csv-crs">{#each ["EPSG:4326", "EPSG:3857", "EPSG:2056", "EPSG:27700", "EPSG:3035", "EPSG:32633"] as c}<option value={c}></option>{/each}</datalist>
      {/if}
    </div>
    {#if !p.guess.crs && o.geometry === "xy"}<p class="hint">{t("The coordinates look projected: set their CRS.")}</p>{/if}
    <div class="csv-preview">
      <table>
        <thead><tr>{#each p.columns as c}<th>{c}</th>{/each}</tr></thead>
        <tbody>{#each p.rows.slice(0, 5) as r}<tr>{#each r as v}<td>{v}</td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
    <p class="hint">{t("Read by QGIS's delimited text provider, as in Desktop.")}</p>
    <footer>
      <button onclick={() => done(null)}>{t("Skip")}</button>
      <button class="primary" onclick={() => done($state.snapshot(o))}>{t("Add layer")}</button>
    </footer>
  </div>
</div>
