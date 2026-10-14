<script lang="ts">
  import { untrack } from "svelte";
  import { FeatureRequestFlag, type QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer, free } from "../lib/engine";
  import { setHighlight, srid } from "../lib/map";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let props: { layerId: string } = $props();

  const ROW = 28;
  // Re-created per layer ({#key} in App), so reading the prop once is intended.
  const layer = untrack(() => findMapLayer(props.layerId)) as QgsVectorLayer;
  const qfields = layer.fields();
  const fields = Array.from({ length: qfields.count() }, (_, i) => qfields.at(i).name());

  let fids: number[] = $state.raw([]);
  let rows: unknown[][] = $state.raw([]);
  let loading = $state(false);
  let filter = $state("");
  let error = $state("");
  let sortCol = $state(-1);
  let sortDir = $state(1);
  let selected = $state<number | null>(null);
  let scrollTop = $state(0);
  let height = $state(240);
  let run = 0;

  /** Reads attributes from the engine in chunks so large layers don't freeze the UI. */
  async function load() {
    const api = engine();
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
  load();

  const order = $derived.by(() => {
    const idx = rows.map((_, i) => i);
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

  function select(i: number) {
    selected = fids[i];
    ui.hits = [];
    const api = engine();
    const req = new api.QgsFeatureRequest();
    req.setFilterFid(fids[i]);
    req.setDestinationCrs(srid());
    const it = layer.getFeatures(req);
    const f = it.nextFeature();
    if (f) setHighlight([f.geometry()], true);
    free(f);
    free(it);
    free(req);
  }

  const fmt = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v));
</script>

<section class="drawer" aria-label="Attribute table">
  <header>
    <h3><Icon name="table" size={16} /> {layer.name} <small class="muted">{fids.length.toLocaleString()}{loading ? "…" : ""} features</small></h3>
    <form class="row filter" onsubmit={(e) => { e.preventDefault(); load(); }}>
      <input placeholder={`Filter expression, e.g. "${fields[0] ?? "field"}" > 10`} bind:value={filter} class:invalid={!!error} title={error} />
      <button type="submit">Filter</button>
      {#if filter}<button type="button" onclick={() => { filter = ""; load(); }}>Clear</button>{/if}
    </form>
    <button class="icon" aria-label="Close table" onclick={() => (ui.tableLayerId = null)}><Icon name="close" size={18} /></button>
  </header>
  {#if error}<p class="error small">{error}</p>{/if}
  <div class="table-scroll" bind:clientHeight={height} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
    <table style:--cols={fields.length}>
      <thead>
        <tr>
          {#each fields as name, i}
            <th><button onclick={() => sortBy(i)}>{name}{sortCol === i ? (sortDir > 0 ? " ▲" : " ▼") : ""}</button></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        <tr style:height="{start * ROW}px"></tr>
        {#each visible as i (fids[i])}
          <tr class:selected={selected === fids[i]} onclick={() => select(i)} style:height="{ROW}px">
            {#each rows[i] as v}<td class:null={v === null}>{fmt(v)}</td>{/each}
          </tr>
        {/each}
        <tr style:height="{Math.max(0, (order.length - start - visible.length) * ROW)}px"></tr>
      </tbody>
    </table>
  </div>
</section>
