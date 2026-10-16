<script lang="ts">
  import { t } from "../lib/i18n";
  import { readBookmarks, addBookmark, renameBookmark, removeBookmark, zoomToBookmark } from "../lib/bookmarks";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const list = $derived((ui.version, ui.phase === "ready" ? readBookmarks() : []));
  let name = $state("");
  let editing = $state<string | null>(null);

  function add(e: Event) {
    e.preventDefault();
    addBookmark(name.trim() || t("Bookmark {n}", { n: list.length + 1 }));
    name = "";
  }
</script>

{#if ui.phase !== "ready"}
  <p class="muted pad">{t("Open a project to use bookmarks.")}</p>
{:else}
  <section class="stack">
    <form class="row" onsubmit={add}>
      <input bind:value={name} placeholder={t("Name for the current view")} aria-label={t("Bookmark name")} />
      <button type="submit"><Icon name="add" size={16} /> {t("Add")}</button>
    </form>
    {#if !list.length}<p class="muted">{t("No bookmarks yet. They are saved in the project, so QGIS Desktop shows them too.")}</p>{/if}
    <ul class="bookmarks">
      {#each list as b (b.id)}
        <li>
          {#if editing === b.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input value={b.name} autofocus onblur={(e) => { editing = null; if (e.currentTarget.value.trim() && e.currentTarget.value !== b.name) renameBookmark(b.id, e.currentTarget.value.trim()); }} onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") editing = null; }} />
          {:else}
            <button class="bm-name" title={t("Zoom to {name}", { name: b.name })} onclick={() => zoomToBookmark(b)} ondblclick={() => (editing = b.id)}><Icon name="bookmark" size={15} /> {b.name}{#if b.group}<span class="muted"> · {b.group}</span>{/if}</button>
          {/if}
          <button class="icon" title={t("Remove")} aria-label={t("Remove {name}", { name: b.name })} onclick={() => removeBookmark(b.id)}><Icon name="trash" size={15} /></button>
        </li>
      {/each}
    </ul>
    {#if list.length}<p class="hint">{t("Click to zoom, double-click to rename.")}</p>{/if}
  </section>
{/if}
