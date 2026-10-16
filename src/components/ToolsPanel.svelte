<script lang="ts">
  import { LayerType, type QgsVectorLayer } from "qgis-js";
  import { ALGORITHMS, runAlgorithm, type Algorithm } from "../lib/processing";
  import { findMapLayer } from "../lib/engine";
  import { flatLayers, snapshotTree } from "../lib/tree";
  import { symbolKind } from "../lib/style";
  import { ui, toast } from "../lib/state.svelte";
  import ExpressionInput from "./ExpressionInput.svelte";
  import Icon from "./Icon.svelte";

  let search = $state("");
  let alg = $state<Algorithm | null>(null);
  let values = $state<Record<string, unknown>>({});
  let running = $state(false);
  let onlySelected = $state(false);

  const KIND = { point: "marker", line: "line", polygon: "fill" } as const;
  const layers = $derived.by(() => {
    ui.version;
    return ui.phase === "ready" ? flatLayers(snapshotTree()).filter((l) => l.valid && l.layerType === LayerType.Vector) : [];
  });
  const groups = $derived.by(() => {
    const q = search.toLowerCase();
    const out: Record<string, Algorithm[]> = {};
    for (const a of ALGORITHMS) if (!q || a.name.toLowerCase().includes(q) || a.id.includes(q)) (out[a.group] ??= []).push(a);
    return Object.entries(out);
  });

  function select(a: Algorithm, preset?: Record<string, unknown>) {
    alg = a;
    values = Object.fromEntries(a.params.map((p) => [p.name, p.type === "layer" ? (layers.find((l) => !p.geometry || symbolKind(l.layerId!) === KIND[p.geometry]) ?? layers[0])?.layerId ?? "" : p.type === "layers" ? [] : p.default ?? ""]));
    if ("INPUT" in values && ui.current && layers.some((l) => l.layerId === ui.current)) values.INPUT = ui.current;
    if (preset) values = { ...values, ...structuredClone(preset) };
  }

  const layerName = (id: unknown) => layers.find((l) => l.layerId === id)?.name ?? "(removed layer)";

  const fieldsOf = (layerId: unknown) => {
    const l = layerId ? (findMapLayer(layerId as string) as QgsVectorLayer | null) : null;
    return l ? Array.from({ length: l.fields().count() }, (_, i) => l.fields().at(i).name()) : [];
  };

  async function run() {
    running = true;
    try {
      const r = await runAlgorithm(alg!, $state.snapshot(values), onlySelected && !!ui.selection[values.INPUT as string]?.length);
      toast(`${alg!.name}: ${r.features.toLocaleString()} features in ${r.ms} ms`);
    } catch (e) {
      toast(`${alg!.name} failed: ${(e as Error).message}`);
    }
    running = false;
  }

  $effect(() => {
    if (ui.pendingAlgorithm) {
      const a = ALGORITHMS.find((x) => x.id === ui.pendingAlgorithm);
      ui.pendingAlgorithm = null;
      if (a) select(a);
    }
  });
</script>

{#if ui.phase !== "ready"}
  <p class="muted pad">Open a project to run processing algorithms.</p>
{:else if !alg}
  <div class="stack">
    <input placeholder="Search algorithms" bind:value={search} />
    {#each groups as [group, algs]}
      <h3 class="group-title">{group}</h3>
      <ul class="alg-list">
        {#each algs as a}<li><button onclick={() => select(a)}><span>{a.name}</span><code>{a.id}</code></button></li>{/each}
      </ul>
    {/each}
    <p class="hint">Geometry runs in GEOS (the library behind QGIS's native algorithms) and attributes and expressions in QGIS. Results are saved to data/processing.gpkg.</p>
    {#if ui.processingHistory.length}
      <h3 class="group-title">History</h3>
      <ul class="history">
        {#each ui.processingHistory as h}
          <li>
            <div><b>{h.name}</b> <span class="muted">{new Date(h.at).toLocaleTimeString()} · {h.features.toLocaleString()} features · {h.ms} ms</span></div>
            <div class="muted small-params">{Object.entries(h.params).map(([k, v]) => `${k}=${typeof v === "string" && v.includes("_") ? layerName(v) : Array.isArray(v) ? v.map(layerName).join("+") : v}`).join(", ")}</div>
            <button class="link" onclick={() => { const a = ALGORITHMS.find((x) => x.id === h.id); if (a) { select(a, h.params); onlySelected = h.onlySelected; } }}>Run again…</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <div class="stack">
    <button class="ghost back" onclick={() => (alg = null)}><span class="flip"><Icon name="chevron" size={14} /></span> All algorithms</button>
    <h3>{alg.name} <code class="muted">{alg.id}</code></h3>
    <p class="muted">{alg.description}</p>
    {#each alg.params as p (p.name)}
      {#if p.type === "layer"}
        <label class="field">{p.label}
          <select bind:value={values[p.name]}>
            {#each layers.filter((l) => !p.geometry || symbolKind(l.layerId!) === KIND[p.geometry]) as l}<option value={l.layerId}>{l.name}</option>{/each}
          </select>
        </label>
      {:else if p.type === "layers"}
        <fieldset class="field layers-param"><legend>{p.label}</legend>
          {#each layers as l}
            <label class="row-inline"><input type="checkbox" checked={(values[p.name] as string[]).includes(l.layerId!)} onchange={(e) => (values[p.name] = e.currentTarget.checked ? [...(values[p.name] as string[]), l.layerId!] : (values[p.name] as string[]).filter((x) => x !== l.layerId))} /> {l.name}</label>
          {/each}
        </fieldset>
      {:else if p.type === "string"}
        <label class="field">{p.label}<input bind:value={values[p.name]} /></label>
      {:else if p.type === "number"}
        <label class="field">{p.label}<input type="number" step="any" bind:value={values[p.name]} /></label>
      {:else if p.type === "enum"}
        <label class="field">{p.label}<select bind:value={values[p.name]}>{#each p.options ?? [] as o, i}<option value={i}>{o}</option>{/each}</select></label>
      {:else if p.type === "bool"}
        <label class="field row-inline"><input type="checkbox" bind:checked={values[p.name] as boolean} /> {p.label}</label>
      {:else if p.type === "field"}
        <label class="field">{p.label}
          <select bind:value={values[p.name]}>
            {#if p.optional}<option value="">(none)</option>{/if}
            {#each fieldsOf(values[p.parent ?? "INPUT"]) as f}<option>{f}</option>{/each}
          </select>
        </label>
      {:else if p.type === "crs"}
        <label class="field">{p.label}<input list="crs-common" bind:value={values[p.name]} /></label>
        <datalist id="crs-common">{#each ["EPSG:4326", "EPSG:3857", "EPSG:8857", "EPSG:3035", "EPSG:2056", "EPSG:27700", "EPSG:32633"] as c}<option value={c}></option>{/each}</datalist>
      {:else if p.type === "expression"}
        <label class="field">{p.label}
          <ExpressionInput layerId={values[p.parent ?? "INPUT"] as string} value={values[p.name] as string} fields={fieldsOf(values[p.parent ?? "INPUT"])} onchange={(v) => (values[p.name] = v)} />
        </label>
      {/if}
    {/each}
    {#if ui.selection[values.INPUT as string]?.length}
      <label class="field row-inline"><input type="checkbox" bind:checked={onlySelected} /> Selected features only ({ui.selection[values.INPUT as string].length})</label>
    {/if}
    <button class="primary" disabled={running || !layers.length} onclick={run}>{running ? "Running…" : "Run"}</button>
  </div>
{/if}
