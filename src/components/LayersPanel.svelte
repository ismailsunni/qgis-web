<script lang="ts">
  import { snapshotTree } from "../lib/engine";
  import { ui } from "../lib/state.svelte";
  import LayerNode from "./LayerNode.svelte";

  const tree = $derived.by(() => (ui.version, ui.phase === "ready" ? snapshotTree() : []));
</script>

{#if ui.phase !== "ready"}
  <p class="muted">Open a project to see its layers.</p>
{:else if !tree.length}
  <p class="muted">This project has no layers.</p>
{:else}
  <ul class="tree" role="tree">
    {#each tree as node (node.key)}<LayerNode {node} />{/each}
  </ul>
  <p class="hint">Click a layer to make it current. Drag-to-reorder needs an upstream qgis-js binding.</p>
{/if}
