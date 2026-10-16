<script lang="ts">
  import { openDemo, openUrl, newProject } from "../lib/actions";
  import { addData } from "../lib/adddata";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import RemoteLayerForm from "./RemoteLayerForm.svelte";
  import BasemapGallery from "./BasemapGallery.svelte";
  import { t } from "../lib/i18n";

  let url = $state("");

  async function pickData(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.length) await addData([...input.files].map((f) => ({ path: f.webkitRelativePath || f.name, data: f })));
    input.value = "";
  }
</script>

<section class="stack">
  <h3>{t("Add layers")}</h3>
  <p class="muted">{t("GeoPackage, GeoJSON, Shapefile (.shp with its files, or .zip), FlatGeobuf, GeoTIFF, GeoParquet, KML, GPX, CSV and Excel.")}</p>
  <label class="button-like primary-like"><Icon name="add" size={18} /> {t("Add data files…")}<input type="file" multiple hidden onchange={pickData} /></label>
  <p class="hint">{t("Data is copied into the project's data/ folder and stays in this browser. You can also drop files on the map.")}</p>
</section>

<section class="stack">
  <h3>{t("Basemaps")}</h3>
  <BasemapGallery />
</section>

<section class="stack">
  <h3>{t("Add a remote layer")}</h3>
  <RemoteLayerForm />
</section>

<section class="stack">
  <h3>{t("Open a project")}</h3>
  <button onclick={() => document.getElementById("pick-folder")?.click()}><Icon name="folder" size={18} /> {t("Open project folder…")}</button>
  <button onclick={() => document.getElementById("pick-files")?.click()}><Icon name="file" size={18} /> {t("Open project files…")}</button>
  <form class="row" onsubmit={(e) => { e.preventDefault(); if (url) openUrl(url); }}>
    <input type="url" placeholder="https://…/project.qgz" bind:value={url} required />
    <button type="submit"><Icon name="link" size={16} /> {t("Open")}</button>
  </form>
  <p class="hint">{t("Relative data sources are fetched next to a remote project. The server must allow CORS.")}</p>
  <div class="row">
    <button onclick={newProject}>{t("New empty project")}</button>
    {#if ui.phase !== "ready"}<button onclick={openDemo}>{t("Demo project")}</button>{/if}
  </div>
</section>
