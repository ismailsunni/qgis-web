<script lang="ts">
  import { LayerType, type QgsLayerTreeLayer } from "qgis-js";
  import { engine, type TreeNode } from "../lib/engine";
  import { toggleNode } from "../lib/actions";
  import { olMap, redraw } from "../lib/map";
  import { ui, changed } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import Self from "./LayerNode.svelte";

  let { node }: { node: TreeNode } = $props();
  let showLegend = $state(false);

  const legend = $derived.by(() =>
    showLegend && !node.isGroup
      ? (node.node as QgsLayerTreeLayer).legendNodes().map((l) => ({ label: l.label(), icon: l.symbolImage(16) }))
      : [],
  );

  function toggleExpanded() {
    node.node.expanded = !node.node.expanded;
    changed();
  }

  function setOpacity(e: Event) {
    const layer = (node.node as QgsLayerTreeLayer).layer();
    if (!layer) return;
    layer.opacity = (e.currentTarget as HTMLInputElement).valueAsNumber / 100;
    changed();
    redraw();
  }

  function zoomTo() {
    const e = engine().fullExtent([node.layerId!]);
    olMap().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [40, 40, 40, 40], duration: 300 });
  }
</script>

<li role="treeitem" aria-selected={ui.current === node.layerId} aria-expanded={node.isGroup ? node.expanded : undefined}>
  <div class="node" class:current={!node.isGroup && ui.current === node.layerId} class:hidden-layer={!node.visible}>
    {#if node.isGroup}
      <button class="icon chev" class:open={node.expanded} aria-label="Expand group" onclick={toggleExpanded}><Icon name="chevron" size={14} /></button>
    {:else}
      <button class="icon chev" class:open={showLegend} aria-label="Show legend" onclick={() => (showLegend = !showLegend)}><Icon name="chevron" size={14} /></button>
    {/if}
    <input type="checkbox" checked={node.checked} aria-label="Visible" onchange={() => toggleNode(node.node)} />
    <button
      class="name"
      class:group={node.isGroup}
      title={node.name}
      onclick={() => !node.isGroup && (ui.current = node.layerId!)}
    >
      {node.name}
    </button>
    {#if !node.isGroup && !node.valid}
      <span class="warn" title="Layer data not found"><Icon name="warn" size={16} /></span>
    {/if}
    {#if !node.isGroup && node.valid}
      <span class="node-actions">
        <button class="icon" title="Zoom to layer" onclick={zoomTo}><Icon name="zoom" size={16} /></button>
        {#if node.layerType === LayerType.Vector}
          <button class="icon" title="Open attribute table" onclick={() => { ui.current = node.layerId!; ui.tableLayerId = node.layerId!; }}><Icon name="table" size={16} /></button>
        {/if}
      </span>
    {/if}
  </div>
  {#if !node.isGroup && ui.current === node.layerId && node.valid}
    <label class="opacity">
      Opacity
      <input type="range" min="0" max="100" value={Math.round((node.opacity ?? 1) * 100)} onchange={setOpacity} />
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
