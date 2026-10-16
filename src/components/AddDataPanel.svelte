<script lang="ts">
  import { openDemo, openUrl, newProject } from "../lib/actions";
  import { addData } from "../lib/adddata";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import RemoteLayerForm from "./RemoteLayerForm.svelte";

  let url = $state("");

  async function pickData(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.length) await addData([...input.files].map((f) => ({ path: f.webkitRelativePath || f.name, data: f })));
    input.value = "";
  }
</script>

<section class="stack">
  <h3>Add layers</h3>
  <p class="muted">GeoPackage, GeoJSON, Shapefile (.shp with its files, or .zip), FlatGeobuf, GeoTIFF, GeoParquet, KML, GPX, CSV and Excel.</p>
  <label class="button-like primary-like"><Icon name="add" size={18} /> Add data files…<input type="file" multiple hidden onchange={pickData} /></label>
  <p class="hint">Data is copied into the project's data/ folder and stays in this browser. You can also drop files on the map.</p>
</section>

<section class="stack">
  <h3>Add a remote layer</h3>
  <RemoteLayerForm />
</section>

<section class="stack">
  <h3>Open a project</h3>
  <button onclick={() => document.getElementById("pick-folder")?.click()}><Icon name="folder" size={18} /> Open project folder…</button>
  <button onclick={() => document.getElementById("pick-files")?.click()}><Icon name="file" size={18} /> Open project files…</button>
  <form class="row" onsubmit={(e) => { e.preventDefault(); if (url) openUrl(url); }}>
    <input type="url" placeholder="https://…/project.qgz" bind:value={url} required />
    <button type="submit"><Icon name="link" size={16} /> Open</button>
  </form>
  <p class="hint">Relative data sources are fetched next to a remote project. The server must allow CORS.</p>
  <div class="row">
    <button onclick={newProject}>New empty project</button>
    {#if ui.phase !== "ready"}<button onclick={openDemo}>Demo project</button>{/if}
  </div>
</section>
