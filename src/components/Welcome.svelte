<script lang="ts">
  import { openDemo, openStored, newProject } from "../lib/actions";
  import { listProjects, deleteProject, type StoredProject } from "../lib/storage";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let recent = $state<StoredProject[]>([]);
  const refresh = () => listProjects().then((r) => (recent = r)).catch(() => {});
  refresh();
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
      {#if ui.phase === "error"}
        <p class="error">{ui.error}</p>
        {#if window.top !== window}<a href={location.href} target="_blank" rel="noopener">Open the map in a new tab</a>{/if}
      {/if}
      <div class="actions">
        <button class="primary" onclick={() => document.getElementById("pick-folder")?.click()}><Icon name="folder" size={18} /> Open project folder</button>
        <button onclick={() => document.getElementById("pick-files")?.click()}><Icon name="file" size={18} /> Open files</button>
        <button onclick={newProject}><Icon name="add" size={18} /> New project</button>
        <button onclick={openDemo}>Try the demo</button>
      </div>
      {#if recent.length}
        <div class="recent">
          <h3>Saved in this browser</h3>
          <ul>
            {#each recent as p (p.id)}
              <li>
                <button class="link-like" onclick={() => openStored(p)}>{p.name}</button>
                <span class="muted">{new Date(p.savedAt).toLocaleString()}</span>
                <button class="icon" title="Delete" onclick={async () => { if (confirm(`Delete “${p.name}” from this browser?`)) { await deleteProject(p.id); refresh(); } }}><Icon name="trash" size={16} /></button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p class="hint">…or drop a .qgs / .qgz with its data anywhere. Nothing is uploaded: your data never leaves this browser.</p>
    {/if}
  </div>
</div>
