<script lang="ts">
  import { findMapLayer } from "../lib/engine";
  import { undo, redo, stopEditing } from "../lib/editing";
  import { setTool, resetTool } from "../lib/editmap";
  import { mergeSelected } from "../lib/editops";
  import { deleteFeatures } from "../lib/editing";
  import { clearSelection } from "../lib/selection";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const name = $derived((ui.version, ui.editing && findMapLayer(ui.editing)?.name));
  const tools = [
    ["add", "Add feature", "add"],
    ["modify", "Edit vertices", "edit"],
    ["delete", "Delete feature", "trash"],
    ["split", "Split features with a line", "split"],
  ] as const;
  const selectedCount = $derived(ui.editing ? (ui.selection[ui.editing]?.length ?? 0) : 0);
</script>

<div class="edit-toolbar card" role="toolbar" aria-label="Editing">
  <span class="edit-name"><Icon name="edit" size={16} /> {name}</span>
  {#each tools as [tool, label, icon]}
    <button class="icon" class:active={ui.editTool === tool} title={label} aria-label={label} onclick={() => setTool(ui.editTool === tool ? null : tool)}><Icon name={icon} size={18} /></button>
  {/each}
  <button class="icon" title="Merge selected features" aria-label="Merge selected features" disabled={selectedCount < 2} onclick={() => mergeSelected()}><Icon name="merge" size={18} /></button>
  <button class="icon" title="Delete selected features" aria-label="Delete selected features" disabled={!selectedCount} onclick={() => { if (confirm(`Delete ${selectedCount} selected features?`)) { deleteFeatures(ui.selection[ui.editing!]); clearSelection(ui.editing!); } }}><Icon name="trash" size={18} /><small>{selectedCount || ""}</small></button>
  <button class="icon" class:active={ui.snapping} title="Snapping to visible layers" aria-label="Snapping" onclick={() => { ui.snapping = !ui.snapping; resetTool(); }}><Icon name="magnet" size={18} /></button>
  <span class="sep"></span>
  <button class="icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!ui.canUndo} onclick={undo}><Icon name="undo" size={18} /></button>
  <button class="icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!ui.canRedo} onclick={redo}><Icon name="redo" size={18} /></button>
  <span class="sep"></span>
  <button class="primary" onclick={() => { setTool(null); stopEditing(); }}>Stop editing</button>
</div>
<p class="edit-hint">
  {#if ui.editTool === "add"}Click on the map to draw; double-click to finish.
  {:else if ui.editTool === "modify"}Click a feature, then drag its vertices.
  {:else if ui.editTool === "delete"}Click a feature to delete it.
  {:else if ui.editTool === "split"}Draw a line across the features to split (the selected ones, or all it crosses); double-click to finish.
  {:else}Click a feature to edit its attributes.{/if}
</p>
