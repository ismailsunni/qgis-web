<script lang="ts">
  import { openDemo } from "../lib/actions";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
</script>

<div class="overlay">
  <div class="welcome card">
    {#if ui.phase === "booting" || ui.phase === "loading"}
      <div class="spinner" aria-hidden="true"></div>
      <p>{ui.status}</p>
      {#if ui.phase === "booting"}<p class="hint">The QGIS engine is about 20 MB; it is cached after the first visit.</p>{/if}
    {:else}
      <h1><span class="logo big"></span>QGIS Web</h1>
      <p class="lead">Open real QGIS projects in your browser, rendered by QGIS itself.</p>
      {#if ui.phase === "error"}<p class="error">{ui.error}</p>{/if}
      <div class="actions">
        <button class="primary" onclick={() => document.getElementById("pick-folder")?.click()}><Icon name="folder" size={18} /> Open project folder</button>
        <button onclick={() => document.getElementById("pick-files")?.click()}><Icon name="file" size={18} /> Open files</button>
        <button onclick={openDemo}>Try the demo</button>
      </div>
      <p class="hint">…or drop a .qgs / .qgz with its data anywhere. Nothing is uploaded: your data never leaves this browser.</p>
    {/if}
  </div>
</div>
