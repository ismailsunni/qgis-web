<script lang="ts">
  import { untrack } from "svelte";
  import type { QgsVectorLayer } from "qgis-js";
  import { findMapLayer } from "../lib/engine";
  import { ensureEditing, addField, renameField, deleteField, editSession, type FieldType } from "../lib/editing";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

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
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Fields")}>
    <header>
      <h2>{t("Fields")} <small>{findMapLayer(layerId)?.name}</small></h2>
      <button class="icon" aria-label={t("Close")} onclick={props.onclose}><Icon name="close" size={18} /></button>
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
            <button class="icon" title={t("Rename")} aria-label={t("Rename {name}", { name: f.name })} onclick={() => (renaming = f.name)}><Icon name="edit" size={15} /></button>
            <button class="icon" title={t("Delete")} aria-label={t("Delete {name}", { name: f.name })} onclick={() => confirm(t("Delete the field {name} and its values?", { name: f.name })) && act(() => deleteField(f.name))}><Icon name="trash" size={15} /></button>
          {/if}
        </li>
      {/each}
    </ul>
    <form class="row" onsubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) act(() => addField(n, type)); name = ""; }}>
      <input bind:value={name} placeholder={t("New field name")} aria-label={t("New field name")} />
      <select bind:value={type} aria-label={t("Type")}>
        <option value="TEXT">{t("Text")}</option><option value="INTEGER">{t("Whole number")}</option><option value="REAL">{t("Decimal")}</option>
        <option value="BOOLEAN">{t("Boolean")}</option><option value="DATE">{t("Date")}</option><option value="DATETIME">{t("Date and time")}</option>
      </select>
      <button type="submit"><Icon name="add" size={16} /> {t("Add")}</button>
    </form>
    <p class="hint">{t("Changes are made in the layer's GeoPackage (starting an edit session) and can be undone.")}</p>
  </div>
</div>
