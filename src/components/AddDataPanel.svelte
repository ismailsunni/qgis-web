<script lang="ts">
  import { openDemo, openUrl } from "../lib/actions";
  import Icon from "./Icon.svelte";

  let url = $state("");
</script>

<section class="stack">
  <h3>Open a QGIS project</h3>
  <p class="muted">Select the project file together with its data, or the whole project folder. Files stay in your browser.</p>
  <button class="primary" onclick={() => document.getElementById("pick-folder")?.click()}><Icon name="folder" size={18} /> Open project folder…</button>
  <button onclick={() => document.getElementById("pick-files")?.click()}><Icon name="file" size={18} /> Open files…</button>
  <p class="hint">Tip: you can also drag a folder or files onto the map.</p>
</section>

<section class="stack">
  <h3>From a URL</h3>
  <form class="row" onsubmit={(e) => { e.preventDefault(); if (url) openUrl(url); }}>
    <input type="url" placeholder="https://…/project.qgz" bind:value={url} required />
    <button type="submit"><Icon name="link" size={16} /> Open</button>
  </form>
  <p class="hint">Relative data sources are fetched next to the project. The server must allow CORS.</p>
</section>

<section class="stack">
  <h3>Sample</h3>
  <button onclick={openDemo}>Open demo project (Natural Earth)</button>
</section>

<section class="stack">
  <h3>Add layers</h3>
  <p class="muted">Adding GeoPackage, GeoJSON, Shapefile, GeoTIFF and more to an open project is planned for M3.</p>
</section>
