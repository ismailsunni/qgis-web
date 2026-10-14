<script lang="ts" module>
  /** Key of the node being dragged in the layer tree. */
  let dragKey: string | null = null;
</script>

<script lang="ts">
  import { LayerType, type QgsLayerTreeLayer } from "qgis-js";
  import { engine } from "../lib/engine";
  import { olMap } from "../lib/map";
  import { setVisible, setExpanded, setOpacity, rename, remove, move, type TreeNode } from "../lib/tree";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import Self from "./LayerNode.svelte";

  let { node }: { node: TreeNode } = $props();
  let showLegend = $state(false);
  let menu = $state(false);
  let editing = $state(false);
  let drop = $state<"before" | "after" | "into" | null>(null);

  const legend = $derived.by(() =>
    showLegend && !node.isGroup
      ? (node.node as QgsLayerTreeLayer).legendNodes().map((l) => ({ label: l.label(), icon: l.symbolImage(16) }))
      : [],
  );

  function zoomTo() {
    const e = engine().fullExtent([node.layerId!]);
    olMap().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [40, 40, 40, 40], duration: 300 });
  }

  function onDragOver(e: DragEvent) {
    if (!dragKey || dragKey === node.key || node.key.startsWith(dragKey + "/")) return;
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    drop = node.isGroup && f > 0.3 && f < 0.7 ? "into" : f < 0.5 ? "before" : "after";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (dragKey && drop) move(dragKey, node.key, drop);
    dragKey = null;
    drop = null;
  }

  function finishRename(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    editing = false;
    if (value && value !== node.name) rename(node, value);
  }

  const run = (fn: () => void) => () => {
    menu = false;
    fn();
  };
</script>

<li role="treeitem" aria-selected={ui.current === node.layerId} aria-expanded={node.isGroup ? node.expanded : undefined}>
  <div
    class="node drop-{drop}"
    class:current={!node.isGroup && ui.current === node.layerId}
    class:hidden-layer={!node.visible}
    draggable={!editing}
    role="presentation"
    ondragstart={(e) => { dragKey = node.key; e.dataTransfer!.effectAllowed = "move"; e.dataTransfer!.setData("text/plain", node.name); e.stopPropagation(); }}
    ondragover={onDragOver}
    ondragleave={() => (drop = null)}
    ondrop={onDrop}
    ondragend={() => { dragKey = null; drop = null; }}
  >
    {#if node.isGroup}
      <button class="icon chev" class:open={node.expanded} aria-label="Expand group" onclick={() => setExpanded(node, !node.expanded)}><Icon name="chevron" size={14} /></button>
    {:else}
      <button class="icon chev" class:open={showLegend} aria-label="Show legend" onclick={() => (showLegend = !showLegend)}><Icon name="chevron" size={14} /></button>
    {/if}
    <input type="checkbox" checked={node.checked} aria-label="Visible" onchange={() => setVisible(node, !node.checked)} />
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="rename" value={node.name} autofocus onblur={finishRename} onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") editing = false; }} />
    {:else}
      <button
        class="name"
        class:group={node.isGroup}
        title={node.name}
        onclick={() => !node.isGroup && (ui.current = node.layerId!)}
        ondblclick={() => (editing = true)}
      >
        {node.name}
      </button>
    {/if}
    {#if !node.isGroup && !node.valid && !node.remote}
      <span class="warn" title="Layer data not found"><Icon name="warn" size={16} /></span>
    {/if}
    {#if node.editing}<span class="badge">editing</span>{/if}
    <span class="node-actions">
      {#if !node.isGroup && (node.valid || node.remote)}
        <button class="icon" title="Zoom to layer" onclick={zoomTo}><Icon name="zoom" size={16} /></button>
      {/if}
      <button class="icon" title="More" aria-label="Layer menu" onclick={() => (menu = !menu)}><Icon name="more" size={16} /></button>
    </span>
    {#if menu}
      <div class="menu card" role="menu">
        <button role="menuitem" onclick={run(() => (editing = true))}>Rename</button>
        {#if !node.isGroup && node.layerType === LayerType.Vector && node.valid}
          <button role="menuitem" onclick={run(() => { ui.current = node.layerId!; ui.tableLayerId = node.layerId!; })}>Open attribute table</button>
        {/if}
        {#if !node.isGroup}
          <button role="menuitem" onclick={run(() => { ui.current = node.layerId!; ui.panel = "style"; })}>Style…</button>
        {/if}
        <button role="menuitem" class="danger" onclick={run(() => remove(node))}>Remove</button>
      </div>
    {/if}
  </div>
  {#if !node.isGroup && ui.current === node.layerId && (node.valid || node.remote)}
    <label class="opacity">
      Opacity
      <input type="range" min="0" max="100" value={Math.round((node.opacity ?? 1) * 100)} onchange={(e) => setOpacity(node, e.currentTarget.valueAsNumber / 100)} />
      <span>{Math.round((node.opacity ?? 1) * 100)}%</span>
    </label>
  {/if}
  {#if showLegend && legend.length}
    <ul class="legend">
      {#each legend as item}
        <li>{#if item.icon}<img src={item.icon} alt="" />{/if}<span>{item.label || node.name}</span></li>
      {/each}
    </ul>
  {/if}
  {#if node.isGroup && node.expanded}
    <ul role="group">
      {#each node.children as child (child.key)}<Self node={child} />{/each}
    </ul>
  {/if}
</li>
