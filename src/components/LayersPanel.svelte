<script lang="ts">
  import { snapshotTree, addGroup, flatLayers } from "../lib/tree";
  import { projectFileHandle } from "../lib/localfs";
  import { openFolder } from "../lib/actions";
  import Icon from "./Icon.svelte";
  import { ui } from "../lib/state.svelte";
  import LayerNode from "./LayerNode.svelte";
  import { t } from "../lib/i18n";

  const tree = $derived.by(() => (ui.version, ui.phase === "ready" ? snapshotTree() : []));
  // Opened as a single file, the browser can't read the data next to it: offer the folder.
  const fileOnly = $derived((ui.version, ui.local !== null && projectFileHandle()));
  const missing = $derived(flatLayers(tree).filter((l) => !l.valid && !l.remote).length);
</script>

{#if ui.phase !== "ready"}
  <p class="muted">{t("Open a project to see its layers.")}</p>
{:else}
  <div class="toolbar">
    <button class="icon" title={t("Add group")} onclick={() => addGroup()}><Icon name="group" size={18} /></button>
    <button class="icon" title={t("Add data")} onclick={() => (ui.panel = "add")}><Icon name="add" size={18} /></button>
  </div>
  {#if fileOnly && missing}
    <div class="notice">
      <p>{missing === 1 ? t("1 layer reads a file next to the project, which the browser can only open with access to the folder.") : t("{n} layers read files next to the project, which the browser can only open with access to the folder.", { n: missing })}</p>
      <button class="primary" onclick={() => openFolder(fileOnly)}><Icon name="folder" size={16} /> {t("Open the project folder")}</button>
    </div>
  {/if}
  {#if !tree.length}<p class="muted pad">{t("This project has no layers yet. Add data to get started.")}</p>{/if}
  <ul class="tree" role="tree">
    {#each tree as node (node.key)}<LayerNode {node} />{/each}
  </ul>
  <p class="hint">{t("Click a layer to make it current, double-click to rename, drag to reorder.")}</p>
{/if}
