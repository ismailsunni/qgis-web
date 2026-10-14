<script lang="ts">
  import { hubIndex, hubUrl, styleDoc, styleContents, applySymbol, applyRamp, applyTextFormat, openHubProject, addLayerDefinition, type HubResource } from "../lib/hub";
  import { findMapLayer } from "../lib/engine";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const TABS = [["Style", "Styles"], ["Geopackage", "Projects"], ["LayerDefinition", "Layers"]] as const;
  let tab = $state<HubResource["type"]>("Style");
  let search = $state("");
  let all = $state<HubResource[]>([]);
  let error = $state("");
  let selected = $state<HubResource | null>(null);
  let contents = $state<ReturnType<typeof styleContents> | null>(null);
  let busy = $state(false);
  hubIndex().then((i) => (all = i.resources)).catch((e) => (error = e.message));

  const shown = $derived.by(() => {
    const q = search.toLowerCase();
    return all.filter((r) => r.type === tab && (!q || `${r.name} ${r.creator} ${r.subtypes ?? ""}`.toLowerCase().includes(q))).slice(0, 120);
  });
  const layerName = $derived((ui.version, ui.current && ui.phase === "ready" ? findMapLayer(ui.current)?.name : null));

  async function open(r: HubResource) {
    selected = r;
    contents = r.type === "Style" ? styleContents(await styleDoc(r)) : null;
  }

  async function run(fn: () => unknown) {
    busy = true;
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

{#if error}
  <p class="muted pad">{error}</p>
{:else if selected}
  <div class="stack">
    <button class="ghost back" onclick={() => (selected = null)}><span class="flip"><Icon name="chevron" size={14} /></span> Back</button>
    {#if selected.thumb}<img class="hub-hero" src={hubUrl(selected.thumb)} alt="" />{/if}
    <h3>{selected.name}</h3>
    <p class="muted">by {selected.creator} · {selected.date} · {selected.downloads.toLocaleString()} downloads{selected.subtypes ? ` · ${selected.subtypes}` : ""}</p>
    <p class="hub-desc">{selected.description}</p>
    {#if selected.type === "Style" && contents}
      {#if !layerName}<p class="hint">Select a layer to apply this style to.</p>{/if}
      {#each contents.symbols as s}
        <button class="primary" disabled={!layerName || busy} onclick={() => run(() => applySymbol(ui.current!, s))}>Apply symbol “{s.getAttribute("name")}” ({s.getAttribute("type")}) to {layerName ?? "layer"}</button>
      {/each}
      {#each contents.ramps as r}
        <button class="primary" disabled={!layerName || busy} onclick={() => run(() => applyRamp(ui.current!, r))}>Use color ramp “{r.getAttribute("name")}” on {layerName ?? "layer"}</button>
      {/each}
      {#each contents.textformats as t}
        <button class="primary" disabled={!layerName || busy} onclick={() => run(() => applyTextFormat(ui.current!, t))}>Use text format “{t.getAttribute("name")}” for labels</button>
      {/each}
      {#if !contents.symbols.length && !contents.ramps.length && !contents.textformats.length}
        <p class="hint">This style contains items (e.g. legend patches or palettes) that can't be applied in the browser yet.</p>
      {/if}
    {:else if selected.type === "Geopackage"}
      <button class="primary" disabled={busy} onclick={() => run(() => openHubProject(selected!))}>{busy ? "Opening…" : "Open project"}</button>
      <p class="hint">Some Hub projects rely on fonts, plugins or online data that aren't available in the browser.</p>
    {:else}
      <button class="primary" disabled={busy} onclick={() => run(() => addLayerDefinition(selected!))}>Add to project</button>
    {/if}
    <a class="hint" href={selected.source} target="_blank" rel="noopener">Original file on hub.qgis.org</a>
  </div>
{:else}
  <div class="stack">
    <div class="tabs" role="tablist">
      {#each TABS as [t, label]}<button role="tab" aria-selected={tab === t} class:active={tab === t} onclick={() => (tab = t)}>{label}</button>{/each}
    </div>
    <input placeholder="Search the QGIS Hub" bind:value={search} />
    <ul class="hub-grid">
      {#each shown as r (r.uuid)}
        <li>
          <button onclick={() => open(r)} title={r.name}>
            {#if r.thumb}<img src={hubUrl(r.thumb)} alt="" loading="lazy" />{:else}<span class="noimg"><Icon name="hub" size={28} /></span>{/if}
            <span class="hub-name">{r.name}</span>
            <span class="muted">{r.subtypes ?? r.creator}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if !shown.length && all.length}<p class="muted">Nothing found.</p>{/if}
    <p class="hint">A mirror of <a href="https://hub.qgis.org" target="_blank" rel="noopener">hub.qgis.org</a>, refreshed when the site is built.</p>
  </div>
{/if}
