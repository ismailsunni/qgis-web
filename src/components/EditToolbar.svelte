<script lang="ts">
  import { t, N_ } from "../lib/i18n";
  import { findMapLayer } from "../lib/engine";
  import { undo, redo, stopEditing } from "../lib/editing";
  import { setTool, resetTool } from "../lib/editmap";
  import { mergeSelected, explodeSelected } from "../lib/editops";
  import { pasteFeatures } from "../lib/clipboard";
  import { deleteFeatures } from "../lib/editing";
  import { clearSelection } from "../lib/selection";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const name = $derived((ui.version, ui.editing && findMapLayer(ui.editing)?.name));
  const tools = [
    ["add", N_("Add feature"), "add"],
    ["modify", N_("Edit vertices"), "edit"],
    ["delete", N_("Delete feature"), "trash"],
    ["split", N_("Split features with a line"), "split"],
    ["move", N_("Move features"), "move"],
    ["rotate", N_("Rotate features"), "rotate"],
  ] as const;
  const selectedCount = $derived(ui.editing ? (ui.selection[ui.editing]?.length ?? 0) : 0);
  const transformHint = $derived.by(() => {
    const n = selectedCount;
    if (ui.editTool === "move")
      return !n ? t("Click a feature to move it, or select features first.") : n === 1 ? t("Drag to move the {n} selected feature; click another feature to switch.", { n }) : t("Drag to move the {n} selected features; click another feature to switch.", { n });
    return !n ? t("Click a feature to rotate it, or select features first.") : n === 1 ? t("Drag to rotate the {n} selected feature; click another feature to switch.", { n }) : t("Drag to rotate the {n} selected features; click another feature to switch.", { n });
  });
</script>

<div class="edit-toolbar card" role="toolbar" aria-label={t("Editing")}>
  <span class="edit-name"><Icon name="edit" size={16} /> {name}</span>
  {#each tools as [tool, label, icon]}
    <button class="icon" class:active={ui.editTool === tool} title={t(label)} aria-label={t(label)} onclick={() => setTool(ui.editTool === tool ? null : tool)}><Icon name={icon} size={18} /></button>
  {/each}
  <button class="icon" title={t("Merge selected features")} aria-label={t("Merge selected features")} disabled={selectedCount < 2} onclick={() => mergeSelected()}><Icon name="merge" size={18} /></button>
  <button class="icon" title={t("Explode selected multipart features into single parts")} aria-label={t("Explode multipart features")} disabled={!selectedCount} onclick={() => explodeSelected()}><Icon name="explode" size={18} /></button>
  <button class="icon" title={t("Paste features (Ctrl+V)")} aria-label={t("Paste features")} disabled={!ui.copiedFeatures} onclick={() => pasteFeatures()}><Icon name="paste" size={18} /></button>
  <button class="icon" title={t("Delete selected features")} aria-label={t("Delete selected features")} disabled={!selectedCount} onclick={() => { if (confirm(t("Delete {n} selected features?", { n: selectedCount }))) { deleteFeatures(ui.selection[ui.editing!]); clearSelection(ui.editing!); } }}><Icon name="trash" size={18} /><small>{selectedCount || ""}</small></button>
  <button class="icon" class:active={ui.snapping} title={t("Snapping to visible layers")} aria-label={t("Snapping")} onclick={() => { ui.snapping = !ui.snapping; resetTool(); }}><Icon name="magnet" size={18} /></button>
  <span class="sep"></span>
  <button class="icon" title={t("Undo (Ctrl+Z)")} aria-label={t("Undo")} disabled={!ui.canUndo} onclick={undo}><Icon name="undo" size={18} /></button>
  <button class="icon" title={t("Redo (Ctrl+Shift+Z)")} aria-label={t("Redo")} disabled={!ui.canRedo} onclick={redo}><Icon name="redo" size={18} /></button>
  <span class="sep"></span>
  <button class="primary" onclick={() => { setTool(null); stopEditing(); }}>{t("Stop editing")}</button>
</div>
<p class="edit-hint">
  {#if ui.editTool === "add"}{t("Click on the map to draw; double-click to finish.")}
  {:else if ui.editTool === "modify"}{t("Click a feature, then drag its vertices.")}
  {:else if ui.editTool === "delete"}{t("Click a feature to delete it.")}
  {:else if ui.editTool === "move" || ui.editTool === "rotate"}{transformHint}
  {:else if ui.editTool === "split"}{t("Draw a line across the features to split (the selected ones, or all it crosses); double-click to finish.")}
  {:else}{t("Click a feature to edit its attributes.")}{/if}
</p>
