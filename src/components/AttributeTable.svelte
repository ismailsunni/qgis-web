<script lang="ts">
  import { untrack } from "svelte";
  import { FeatureRequestFlag, type QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer, free } from "../lib/engine";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import ExpressionBuilder from "./ExpressionBuilder.svelte";
  import FieldCalculator from "./FieldCalculator.svelte";
  import FieldsDialog from "./FieldsDialog.svelte";
  import ExportLayerDialog from "./ExportLayerDialog.svelte";
  import StatisticsDialog from "./StatisticsDialog.svelte";
  import { setAttribute, editSession, deleteFeatures } from "../lib/editing";
  import * as Sel from "../lib/selection";
  import { readForm, displayValue, parseInput, validate } from "../lib/forms";

  let props: { layerId: string } = $props();
  // Re-created per layer ({#key} in App), so reading the prop once is intended.
  const layerId = untrack(() => props.layerId);

  const ROW = 28;
  let layer = $state.raw(findMapLayer(layerId) as QgsVectorLayer);
  let fields = $state<string[]>([]);
  let fids: number[] = $state.raw([]);
  let rows: unknown[][] = $state.raw([]);
  let loading = $state(false);
  let filter = $state("");
  let error = $state("");
  let sortCol = $state(-1);
  let sortDir = $state(1);
  let scrollTop = $state(0);
  let dialog = $state<"filter" | "select" | "calc" | "fields" | "export" | "stats" | null>(null);
  let selectedOnly = $state(false);
  let editingCell = $state<[number, number] | null>(null);
  let height = $state(240);
  let run = 0;
  let anchor = -1;

  const editable = $derived(ui.editing === layerId);
  const selection = $derived(new Set(ui.selection[layerId] ?? []));

  const forms = $derived((ui.version, readForm(layerId)));

  function commitCell(row: number, col: number, text: string) {
    editingCell = null;
    const old = rows[row][col];
    const form = forms.get(fields[col]);
    const value = parseInput(form, text, old);
    if (value === old) return;
    const check = validate(layerId, fids[row], form, value);
    if (check.error) return toast(check.error);
    if (check.warning) toast(check.warning);
    setAttribute(fids[row], fields[col], value);
    rows[row][col] = value;
    rows = [...rows];
  }

  /** Reads attributes from the engine in chunks so large layers don't freeze the UI. */
  async function load() {
    const api = engine();
    layer = findMapLayer(layerId) as QgsVectorLayer;
    if (!layer) return;
    const qf = layer.fields();
    fields = Array.from({ length: qf.count() }, (_, i) => qf.at(i).name());
    if (filter) {
      const e = new api.QgsExpression(filter);
      error = e.hasParserError() ? e.parserErrorString() : "";
      free(e);
      if (error) return;
    }
    const id = ++run;
    loading = true;
    const req = new api.QgsFeatureRequest();
    req.setFlags(FeatureRequestFlag.NoGeometry);
    if (filter) req.setFilterExpression(filter);
    const it = layer.getFeatures(req);
    const f2: number[] = [];
    const r2: unknown[][] = [];
    for (let f = it.nextFeature(); f; f = it.nextFeature()) {
      f2.push(f.id());
      r2.push(f.attributes());
      free(f);
      if (f2.length % 5000 === 0) {
        fids = f2.slice();
        rows = r2.slice();
        await new Promise((r) => setTimeout(r));
        if (id !== run) {
          free(it);
          free(req);
          return;
        }
      }
    }
    free(it);
    free(req);
    fids = f2;
    rows = r2;
    loading = false;
  }

  // Reload when the layer's data changes (edits, field calculator, undo).
  $effect(() => {
    ui.dataVersion;
    untrack(load);
  });

  const order = $derived.by(() => {
    let idx = rows.map((_, i) => i);
    if (selectedOnly) idx = idx.filter((i) => selection.has(fids[i]));
    if (sortCol < 0) return idx;
    const cmp = (a: unknown, b: unknown) =>
      a === b ? 0 : a === null ? 1 : b === null ? -1 : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return idx.sort((a, b) => sortDir * cmp(rows[a][sortCol], rows[b][sortCol]));
  });

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 5));
  const visible = $derived(order.slice(start, start + Math.ceil(height / ROW) + 10));

  function sortBy(i: number) {
    if (sortCol === i) sortDir = -sortDir;
    else (sortCol = i), (sortDir = 1);
  }

  /** Click selects and zooms; Ctrl/Cmd toggles; Shift selects a range, as in QGIS's table. */
  function rowClick(i: number, e: MouseEvent) {
    ui.hits = [];
    const fid = fids[i];
    if (e.shiftKey && anchor >= 0) {
      const a = order.indexOf(anchor), b = order.indexOf(i);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1).map((k) => fids[k]);
      Sel.selectFids(layerId, range, "add");
    } else if (e.ctrlKey || e.metaKey) {
      Sel.selectFids(layerId, [fid], selection.has(fid) ? "remove" : "add");
      anchor = i;
    } else {
      Sel.selectFids(layerId, [fid], "new");
      anchor = i;
      Sel.zoomToSelection();
    }
  }

  async function deleteSelected() {
    const n = selection.size;
    if (n && confirm(`Delete ${n} selected feature${n === 1 ? "" : "s"}?`)) {
      deleteFeatures([...selection]);
      Sel.clearSelection(layerId);
    }
  }

  const fmt = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v));
</script>

{#if dialog === "filter" || dialog === "select"}
  <ExpressionBuilder
    {layerId}
    initial={dialog === "filter" ? filter : ""}
    title={dialog === "filter" ? "Filter" : "Select by expression"}
    onclose={() => (dialog = null)}
    onapply={(v) => {
      if (dialog === "filter") {
        filter = v;
        load();
      } else Sel.selectByExpression(layerId, v, "new");
      dialog = null;
    }}
  />
{:else if dialog === "calc"}
  <FieldCalculator {layerId} onclose={() => (dialog = null)} />
{:else if dialog === "fields"}
  <FieldsDialog {layerId} onclose={() => (dialog = null)} />
{:else if dialog === "export"}
  <ExportLayerDialog {layerId} onclose={() => (dialog = null)} />
{:else if dialog === "stats"}
  <StatisticsDialog
    title={layer.name}
    {fields}
    scope={selectedOnly ? "selected features" : filter ? "filtered features" : "all features"}
    column={(f) => { const c = fields.indexOf(f); return order.map((i) => rows[i][c]); }}
    onclose={() => (dialog = null)}
  />
{/if}

<section class="drawer" aria-label="Attribute table">
  <header>
    <h3>
      <Icon name="table" size={16} /> {layer?.name}
      <small class="muted">{fids.length.toLocaleString()}{loading ? "…" : ""} features{selection.size ? `, ${selection.size.toLocaleString()} selected` : ""}{editable ? " · double-click a cell to edit" : ""}</small>
    </h3>
    <div class="table-tools">
      <button class="icon" title="Select by expression" aria-label="Select by expression" onclick={() => (dialog = "select")}><Icon name="expr" size={16} /></button>
      <button class="icon" title="Invert selection" aria-label="Invert selection" onclick={() => Sel.invertSelection(layerId)}><Icon name="selectbox" size={16} /></button>
      <button class="icon" title="Clear selection" aria-label="Clear selection" disabled={!selection.size} onclick={() => Sel.clearSelection(layerId)}><Icon name="close" size={16} /></button>
      <button class="icon" title="Zoom to selection" aria-label="Zoom to selection" disabled={!selection.size} onclick={() => Sel.zoomToSelection()}><Icon name="zoom" size={16} /></button>
      <button class="icon" class:active={selectedOnly} title="Show selected features only" aria-label="Show selected only" onclick={() => (selectedOnly = !selectedOnly)}><Icon name="select" size={16} /></button>
      <span class="sep"></span>
      <button class="icon" title="Field calculator" aria-label="Field calculator" onclick={() => (dialog = "calc")}><Icon name="calc" size={16} /></button>
      <button class="icon" title="Fields (add, rename, delete)" aria-label="Fields" onclick={() => (dialog = "fields")}><Icon name="columns" size={16} /></button>
      <button class="icon" title="Statistics" aria-label="Statistics" onclick={() => (dialog = "stats")}><Icon name="chart" size={16} /></button>
      <button class="icon" title="Export layer" aria-label="Export layer" onclick={() => (dialog = "export")}><Icon name="download" size={16} /></button>
      {#if editable}<button class="icon" title="Delete selected features" aria-label="Delete selected features" disabled={!selection.size} onclick={deleteSelected}><Icon name="trash" size={16} /></button>{/if}
    </div>
    <form class="row filter" onsubmit={(e) => { e.preventDefault(); load(); }}>
      <input placeholder={`Filter, e.g. "${fields[1] ?? fields[0] ?? "field"}" > 10`} bind:value={filter} class:invalid={!!error} title={error} />
      <button type="button" class="icon" title="Expression builder" onclick={() => (dialog = "filter")}><Icon name="expr" size={16} /></button>
      <button type="submit">Filter</button>
      {#if filter}<button type="button" onclick={() => { filter = ""; load(); }}>Clear</button>{/if}
    </form>
    <button class="icon" aria-label="Close table" onclick={() => (ui.tableLayerId = null)}><Icon name="close" size={18} /></button>
  </header>
  {#if error}<p class="error small">{error}</p>{/if}
  <div class="table-scroll" bind:clientHeight={height} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
    <table>
      <thead>
        <tr>
          {#each fields as name, i}
            {#if !forms.get(name)?.hidden}<th><button title={forms.get(name)?.alias ? name : undefined} onclick={() => sortBy(i)}>{forms.get(name)?.alias || name}{sortCol === i ? (sortDir > 0 ? " ▲" : " ▼") : ""}</button></th>{/if}
          {/each}
        </tr>
      </thead>
      <tbody>
        <tr style:height="{start * ROW}px"></tr>
        {#each visible as i (fids[i])}
          <tr class:selected={selection.has(fids[i])} onclick={(e) => rowClick(i, e)} style:height="{ROW}px">
            {#each rows[i] as v, c}
              {@const form = forms.get(fields[c])}
              {#if editingCell?.[0] === i && editingCell?.[1] === c}
                <td>
                  {#if form?.widget === "ValueMap"}
                    <!-- svelte-ignore a11y_autofocus -->
                    <select autofocus value={v === null ? "" : String(v)} onchange={(e) => commitCell(i, c, e.currentTarget.value)} onblur={() => (editingCell = null)}>
                      {#if !form.notNull}<option value="">NULL</option>{/if}
                      {#each form.options as [label, val]}<option value={val}>{label}</option>{/each}
                    </select>
                  {:else}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input value={v === null ? "" : String(v)} autofocus onblur={(e) => commitCell(i, c, e.currentTarget.value)} onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") editingCell = null; }} />
                  {/if}
                </td>
              {:else if !form?.hidden}
                <td class:null={v === null} ondblclick={() => editable && fields[c] !== editSession()?.info.fid && !form?.readOnly && (editingCell = [i, c])}>{form ? displayValue(form, v) : fmt(v)}</td>
              {/if}
            {/each}
          </tr>
        {/each}
        <tr style:height="{Math.max(0, (order.length - start - visible.length) * ROW)}px"></tr>
      </tbody>
    </table>
  </div>
</section>
