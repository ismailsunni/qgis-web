<script lang="ts">
  import { snapshotTree, addGroup } from "../lib/tree";
  import Icon from "./Icon.svelte";
  import { ui } from "../lib/state.svelte";
  import LayerNode from "./LayerNode.svelte";
  import { t } from "../lib/i18n";

  const tree = $derived.by(() => (ui.version, ui.phase === "ready" ? snapshotTree() : []));
</script>

{#if ui.phase !== "ready"}
  <p class="muted">{t("Open a project to see its layers.")}</p>
{:else}
  <div class="toolbar">
    <button class="icon" title={t("Add group")} onclick={() => addGroup()}><Icon name="group" size={18} /></button>
    <button class="icon" title={t("Add data")} onclick={() => (ui.panel = "add")}><Icon name="add" size={18} /></button>
  </div>
  {#if !tree.length}<p class="muted pad">{t("This project has no layers yet. Add data to get started.")}</p>{/if}
  <ul class="tree" role="tree">
    {#each tree as node (node.key)}<LayerNode {node} />{/each}
  </ul>
  <p class="hint">{t("Click a layer to make it current, double-click to rename, drag to reorder.")}</p>
{/if}
