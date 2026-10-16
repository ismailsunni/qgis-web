<script lang="ts">
  import { untrack } from "svelte";
  import type { QgsVectorLayer } from "qgis-js";
  import { findMapLayer } from "../lib/engine";
  import { ensureEditing, addField, renameField, deleteField, editSession, type FieldType } from "../lib/editing";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let props: { layerId: string; onclose: () => void } = $props();
  const layerId = untrack(() => props.layerId);

  const fields = $derived.by(() => {
    ui.dataVersion;
    const l = findMapLayer(layerId) as QgsVectorLayer | null;
    return l ? Array.from({ length: l.fields().count() }, (_, i) => ({ name: l.fields().at(i).name(), type: l.fields().at(i).typeName() })) : [];
  });
  let name = $state("");
  let type = $state<FieldType>("TEXT");
  let renaming = $state<string | null>(null);

  const protectedField = (f: string) => f === "fid" || f === editSession()?.info.geom;

  async function act(fn: () => void) {
    try {
      if (await ensureEditing(layerId)) fn();
    } catch (e) {
      toast((e as Error).message);
    }
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Fields">
    <header>
      <h2>Fields <small>{findMapLayer(layerId)?.name}</small></h2>
      <button class="icon" aria-label="Close" onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <ul class="field-list">
      {#each fields as f (f.name)}
        <li>
          {#if renaming === f.name}
            <!-- svelte-ignore a11y_autofocus -->
            <input value={f.name} autofocus onblur={(e) => { const to = e.currentTarget.value.trim(); renaming = null; if (to && to !== f.name) act(() => renameField(f.name, to)); }} onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") renaming = null; }} />
          {:else}
            <span class="fname">{f.name}</span>
          {/if}
          <span class="muted">{f.type}</span>
          {#if !protectedField(f.name)}
            <button class="icon" title="Rename" aria-label="Rename {f.name}" onclick={() => (renaming = f.name)}><Icon name="edit" size={15} /></button>
            <button class="icon" title="Delete" aria-label="Delete {f.name}" onclick={() => confirm(`Delete the field ${f.name} and its values?`) && act(() => deleteField(f.name))}><Icon name="trash" size={15} /></button>
          {/if}
        </li>
      {/each}
    </ul>
    <form class="row" onsubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) act(() => addField(n, type)); name = ""; }}>
      <input bind:value={name} placeholder="New field name" aria-label="New field name" />
      <select bind:value={type} aria-label="Type">
        <option value="TEXT">Text</option><option value="INTEGER">Whole number</option><option value="REAL">Decimal</option>
        <option value="BOOLEAN">Boolean</option><option value="DATE">Date</option><option value="DATETIME">Date and time</option>
      </select>
      <button type="submit"><Icon name="add" size={16} /> Add</button>
    </form>
    <p class="hint">Changes are made in the layer's GeoPackage (starting an edit session) and can be undone.</p>
  </div>
</div>
