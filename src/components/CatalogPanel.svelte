<script lang="ts">
  import { onDestroy } from "svelte";
  import VectorLayer from "ol/layer/Vector";
  import VectorSource from "ol/source/Vector";
  import GeoJSON from "ol/format/GeoJSON";
  import { transformExtent } from "ol/proj";
  import { Style, Stroke, Fill } from "ol/style";
  import type Feature from "ol/Feature";
  import { olMap, mapProjection } from "../lib/map";
  import { STAC_APIS, STAC_PRESETS, PORTALS, stacSearch, stacCollections, addStacItem, portalSearch, resourceKind, addResource, type StacItem, type Dataset, type Resource } from "../lib/catalog";
  import { ui, toast } from "../lib/state.svelte";
  import { t } from "../lib/i18n";
  import Icon from "./Icon.svelte";

  /** Open data catalogs: imagery and elevation from STAC APIs, data from CKAN portals. */
  let tab = $state<"stac" | "portal">("stac");
  let busy = $state(false);

  // ---- STAC ----
  let api = $state(STAC_APIS[0].url);
  let collections = $state(STAC_PRESETS.map((p) => ({ id: p.id, title: p.title })));
  let collection = $state(STAC_PRESETS[0].id);
  const preset = $derived(STAC_PRESETS.find((p) => p.id === collection && api === STAC_APIS[0].url));
  const ago = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  let from = $state(ago);
  let to = $state("");
  let maxCloud = $state(20);
  let items = $state<StacItem[]>([]);
  let hovered = $state<string | null>(null);

  // Footprints of the results on the map (the hovered one highlighted).
  const source = new VectorSource();
  const footprints = new VectorLayer({
    source,
    zIndex: 1003,
    style: (f) => new Style({ stroke: new Stroke({ color: f.get("id") === hovered ? "#e8590c" : "rgba(26,115,232,0.8)", width: f.get("id") === hovered ? 2.5 : 1.2 }), fill: new Fill({ color: f.get("id") === hovered ? "rgba(232,89,12,0.12)" : "rgba(26,115,232,0.04)" }) }),
  });
  olMap().addLayer(footprints);
  onDestroy(() => olMap().removeLayer(footprints));
  $effect(() => {
    hovered;
    footprints.changed();
  });

  async function changeApi() {
    try {
      collections = api === STAC_APIS[0].url ? STAC_PRESETS.map((p) => ({ id: p.id, title: p.title })) : await stacCollections(api);
      collection = collections[0]?.id ?? "";
    } catch (e) {
      toast(t("Could not read the catalog: {error}", { error: (e as Error).message }));
    }
  }

  async function searchStac() {
    busy = true;
    try {
      // Beyond the CRS's valid area (e.g. a world view in Equal Earth) corners don't convert: use the world's limits.
      const [w, s, e, n] = transformExtent(olMap().getView().calculateExtent(olMap().getSize()), mapProjection(), "EPSG:4326", 8);
      const ok = (v: number, d: number) => (Number.isFinite(v) ? v : d);
      const bbox = [Math.max(-180, ok(w, -180)), Math.max(-90, ok(s, -90)), Math.min(180, ok(e, 180)), Math.min(90, ok(n, 90))];
      items = [];
      items = await stacSearch(api, collection, bbox, { from, to, maxCloud: preset?.cloud ? maxCloud : undefined, asset: preset?.asset });
      source.clear();
      const geojson = new GeoJSON();
      for (const i of items) {
        const f = geojson.readFeature({ type: "Feature", geometry: i.geometry, properties: { id: i.id } }, { dataProjection: "EPSG:4326", featureProjection: mapProjection() }) as Feature;
        source.addFeature(f);
      }
      if (!items.length) toast(t("Nothing found here: zoom out, or widen the dates."));
    } catch (e) {
      toast(t("Could not search the catalog: {error}", { error: (e as Error).message }));
    }
    busy = false;
  }

  async function addItem(i: StacItem) {
    await addStacItem(i);
    toast(t("Added {name}", { name: i.id }));
  }

  // ---- Portals ----
  let portal = $state(PORTALS[0].url);
  let custom = $state("");
  let q = $state("");
  let datasets = $state<Dataset[]>([]);

  async function searchPortals(e: Event) {
    e.preventDefault();
    busy = true;
    datasets = [];
    try {
      datasets = await portalSearch((portal === "custom" ? custom : portal).replace(/\/$/, ""), q);
      if (!datasets.length) toast(t("No datasets with map data found."));
    } catch (err) {
      toast(t("Could not search the catalog: {error}", { error: (err as Error).message }));
    }
    busy = false;
  }

  async function add(r: Resource) {
    const kind = resourceKind(r);
    if (kind === "wms" || kind === "wfs" || kind === "arcgis") {
      ui.remotePrefill = { kind: kind === "arcgis" ? (/featureserver/i.test(r.url) ? "arcgisfeature" : "arcgismap") : kind, url: r.url };
      ui.panel = "add";
      return toast(t("Choose the layer to add from the service."));
    }
    busy = true;
    try {
      await addResource(r);
    } catch {
      // Usually the portal's file server doesn't allow reading from other sites (CORS).
      toast(t("The browser can't load this file from its server; it opens in a new tab so you can download it and drop it on the map."));
      window.open(r.url, "_blank", "noopener");
    }
    busy = false;
  }
</script>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected={tab === "stac"} class:active={tab === "stac"} onclick={() => (tab = "stac")}>{t("Imagery & elevation")}</button>
  <button role="tab" aria-selected={tab === "portal"} class:active={tab === "portal"} onclick={() => (tab = "portal")}>{t("Data portals")}</button>
</div>

{#if tab === "stac"}
  <div class="stack-tight catalog">
    <label class="field">{t("Catalog (STAC)")}
      <input list="stac-apis" bind:value={api} onchange={changeApi} />
      <datalist id="stac-apis">{#each STAC_APIS as a}<option value={a.url}>{a.name}</option>{/each}</datalist>
    </label>
    <label class="field">{t("Collection")}
      <select bind:value={collection}>{#each collections as c}<option value={c.id}>{c.title}</option>{/each}</select>
    </label>
    <div class="grid2">
      <label class="field">{t("From")}<input type="date" bind:value={from} /></label>
      <label class="field">{t("To")}<input type="date" bind:value={to} /></label>
    </div>
    {#if preset?.cloud}
      <label class="field">{t("Clouds below {n}%", { n: maxCloud })}<input type="range" min="0" max="100" step="5" bind:value={maxCloud} /></label>
    {/if}
    <button class="primary" disabled={busy || !collection} onclick={searchStac}><Icon name="search" size={16} /> {busy ? t("Searching…") : t("Search this map area")}</button>
    {#each items as i (i.id)}
      <div class="catalog-item" role="listitem" class:hovered={hovered === i.id} onmouseenter={() => (hovered = i.id)} onmouseleave={() => (hovered = null)}>
        {#if i.thumbnail}<img src={i.thumbnail} alt="" loading="lazy" crossorigin="anonymous" />{/if}
        <div>
          <b>{i.datetime.slice(0, 10)}</b>
          <span class="muted">{i.id}</span>
          {#if i.cloud !== null}<span class="muted">{t("{n}% clouds", { n: Math.round(i.cloud) })}</span>{/if}
        </div>
        <button onclick={() => addItem(i)}>{t("Add")}</button>
      </div>
    {/each}
    <p class="hint">{t("Images are cloud-optimized GeoTIFFs read straight from the catalog's storage, only the parts in view.")}</p>
  </div>
{:else}
  <form class="stack-tight catalog" onsubmit={searchPortals}>
    <label class="field">{t("Portal")}
      <select bind:value={portal}>
        {#each PORTALS as p}<option value={p.url}>{p.name}</option>{/each}
        <option value="custom">{t("Another CKAN portal…")}</option>
      </select>
    </label>
    {#if portal === "custom"}<input type="url" placeholder="https://…/" bind:value={custom} required />{/if}
    <div class="row">
      <input placeholder={t("Search, e.g. roads, schools, flood")} bind:value={q} required />
      <button class="primary" disabled={busy}>{t("Search")}</button>
    </div>
    {#each datasets as d}
      <div class="catalog-dataset">
        <a href={d.page} target="_blank" rel="noopener"><b>{d.title}</b></a>
        {#if d.org}<span class="muted">{d.org}</span>{/if}
        <div class="resources">
          {#each d.resources.slice(0, 6) as r}
            <button class="chip" title={r.name} disabled={busy} onclick={() => add(r)}>{r.format || "?"} · {t("Add")}</button>
          {/each}
        </div>
      </div>
    {/each}
    <p class="hint">{t("Web files are linked where possible (the project keeps their address); others are downloaded into the project. Some portals don't let browsers load their files: those open in a new tab to download.")}</p>
  </form>
{/if}
