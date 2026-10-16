<script lang="ts">
  import { openDemo, openStored, newProject, recoverAutosave, openFolder, openProjectFiles, openRecentLocal } from "../lib/actions";
  import { recentLocal, deleteRecent, type LocalRecent } from "../lib/localfs";
  import { listProjects, deleteProject, readAutosave, clearAutosave, type StoredProject, type AutosaveMeta } from "../lib/storage";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

  let recent = $state<StoredProject[]>([]);
  let autosave = $state<AutosaveMeta | null>(null);
  readAutosave().then((a) => (autosave = a)).catch(() => {});
  const refresh = () => listProjects().then((r) => (recent = r)).catch(() => {});
  refresh();
  let local = $state<LocalRecent[]>([]);
  const refreshLocal = () => recentLocal().then((r) => (local = r));
  refreshLocal();
</script>

<div class="overlay">
  <div class="welcome card">
    {#if ui.phase === "booting" || ui.phase === "loading"}
      <div class="spinner" aria-hidden="true"></div>
      <p>{ui.status}</p>
      {#if ui.phase === "booting"}<p class="hint">{t("The QGIS engine is about 20 MB; it is cached after the first visit.")}</p>{/if}
    {:else}
      <h1><span class="logo big"></span>QuarkGIS</h1>
      <p class="lead">{t("Open real QGIS projects in your browser, rendered by QGIS itself.")}</p>
      {#if autosave && ui.phase !== "error"}
        {@const msg = t("{found} in “{name}” ({date}).", { name: autosave.name, date: new Date(autosave.savedAt).toLocaleString() }).split("{found}")}
        <div class="recover">
          <p>{msg[0]}<b>{t("Unsaved changes found")}</b>{msg[1]}</p>
          <div class="row">
            <button class="primary" onclick={() => recoverAutosave()}>{t("Recover")}</button>
            <button onclick={async () => { if (confirm(t("Discard the unsaved changes?"))) { await clearAutosave(); autosave = null; } }}>{t("Discard")}</button>
          </div>
        </div>
      {/if}
      {#if ui.phase === "error"}
        <p class="error">{ui.error}</p>
        {#if window.top !== window}<a href={location.href} target="_blank" rel="noopener">{t("Open the map in a new tab")}</a>{/if}
      {/if}
      <div class="actions">
        <button class="primary" onclick={openFolder}><Icon name="folder" size={18} /> {t("Open project folder")}</button>
        <button onclick={openProjectFiles}><Icon name="file" size={18} /> {t("Open files")}</button>
        <button onclick={newProject}><Icon name="add" size={18} /> {t("New project")}</button>
        <button onclick={openDemo}>{t("Try the demo")}</button>
      </div>
      {#if local.length}
        <div class="recent">
          <h3>{t("Recent on this computer")}</h3>
          <ul>
            {#each local as p (p.id)}
              <li>
                <button class="link-like" title={p.dir ? p.dir.name : p.projectPath} onclick={() => openRecentLocal(p)}>{p.name}</button>
                <span class="muted">{p.dir?.name ?? p.projectPath}</span>
                <button class="icon" title={t("Remove from the list")} onclick={async () => { await deleteRecent(p.id); refreshLocal(); }}><Icon name="close" size={16} /></button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if recent.length}
        <div class="recent">
          <h3>{t("Saved in this browser")}</h3>
          <ul>
            {#each recent as p (p.id)}
              <li>
                <button class="link-like" onclick={() => openStored(p)}>{p.name}</button>
                <span class="muted">{new Date(p.savedAt).toLocaleString()}</span>
                <button class="icon" title={t("Delete")} onclick={async () => { if (confirm(t("Delete “{name}” from this browser?", { name: p.name }))) { await deleteProject(p.id); refresh(); } }}><Icon name="trash" size={16} /></button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p class="hint">{t("…or drop a .qgs / .qgz with its data anywhere. Nothing is uploaded: your data never leaves this browser.")}</p>
      <p class="welcome-links">
        <button class="link" onclick={() => (ui.dialog = "settings")}>{t("Choose what opens on launch…")}</button> ·
        <a class="link" href={`${import.meta.env.BASE_URL}docs/`} target="_blank" rel="noopener">{t("Documentation")}</a>
      </p>
    {/if}
  </div>
</div>
