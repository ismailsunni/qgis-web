<script lang="ts">
  import WMSCapabilities from "ol/format/WMSCapabilities";
  import WMTSCapabilities from "ol/format/WMTSCapabilities";
  import { addRemote, PRESETS, type RemoteKind } from "../lib/remote";
  import { toast } from "../lib/state.svelte";

  const KINDS: [RemoteKind, string, string][] = [
    ["xyz", "XYZ tiles", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    ["wms", "WMS", "https://ows.terrestris.de/osm/service"],
    ["wmts", "WMTS", "https://…/WMTSCapabilities.xml"],
    ["wfs", "WFS", "https://…/wfs"],
    ["vectortile", "Vector tiles (MVT)", "https://…/{z}/{x}/{y}.pbf"],
    ["pmtiles", "PMTiles archive", "https://…/tiles.pmtiles"],
    ["oapif", "OGC API Features", "https://…/ogcapi (landing page)"],
    ["arcgisfeature", "ArcGIS FeatureServer", "https://…/FeatureServer/0"],
    ["arcgismap", "ArcGIS MapServer", "https://…/MapServer"],
    ["cog", "Cloud Optimized GeoTIFF", "https://…/image.tif"],
    ["file", "Vector file by URL", "https://…/data.fgb (FlatGeobuf, GeoJSON, GeoPackage)"],
  ];

  let kind = $state<RemoteKind>("xyz");
  let url = $state("");
  let name = $state("");
  let layers = $state<{ name: string; title: string; sets?: string[] }[]>([]);
  let layer = $state("");
  let matrixSet = $state("");
  let loading = $state(false);

  const needsCaps = $derived(["wms", "wmts", "wfs", "oapif", "arcgismap"].includes(kind) || (kind === "arcgisfeature" && !/\/\d+\/?$/.test(url)));

  async function loadCaps() {
    loading = true;
    layers = [];
    try {
      const u = new URL(url);
      if (kind === "oapif") {
        const r = await (await fetch(`${url.replace(/\/$/, "")}/collections?f=json`, { headers: { Accept: "application/json" } })).json();
        layers = (r.collections ?? []).map((c: any) => ({ name: c.id, title: c.title || c.id }));
        layer = layers[0]?.name ?? "";
        loading = false;
        return;
      }
      if (kind === "arcgisfeature" || kind === "arcgismap") {
        const r = await (await fetch(`${url.replace(/\/$/, "")}?f=json`)).json();
        layers = (r.layers ?? []).filter((l: any) => !l.subLayerIds?.length || kind === "arcgismap").map((l: any) => ({ name: String(l.id), title: l.name }));
        layer = layers[0]?.name ?? "";
        loading = false;
        return;
      }
      if (kind !== "wmts") {
        u.searchParams.set("service", kind.toUpperCase());
        u.searchParams.set("request", "GetCapabilities");
      }
      const text = await (await fetch(u)).text();
      if (kind === "wms") {
        const caps = new WMSCapabilities().read(text);
        const walk = (l: any): any[] => [...(l?.Name ? [{ name: l.Name, title: l.Title || l.Name }] : []), ...(l?.Layer ?? []).flatMap(walk)];
        layers = walk(caps?.Capability?.Layer);
      } else if (kind === "wmts") {
        const caps = new WMTSCapabilities().read(text);
        layers = (caps?.Contents?.Layer ?? []).map((l: any) => ({ name: l.Identifier, title: l.Title || l.Identifier, sets: l.TileMatrixSetLink.map((s: any) => s.TileMatrixSet) }));
      } else {
        const xml = new DOMParser().parseFromString(text, "application/xml");
        layers = [...xml.getElementsByTagNameNS("*", "FeatureType")].map((f) => ({
          name: f.getElementsByTagNameNS("*", "Name")[0]?.textContent ?? "",
          title: f.getElementsByTagNameNS("*", "Title")[0]?.textContent ?? "",
        }));
      }
      layer = layers[0]?.name ?? "";
      if (!layers.length) toast("No layers found in the capabilities document.");
    } catch (e) {
      toast(`Could not read capabilities: ${(e as Error).message}. The server must allow CORS.`);
    }
    loading = false;
  }

  $effect(() => {
    const sets = layers.find((l) => l.name === layer)?.sets ?? [];
    matrixSet = sets.find((s) => /3857|google|webmercator/i.test(s)) ?? sets[0] ?? "";
  });

  async function add(e: Event) {
    e.preventDefault();
    const title = name || layers.find((l) => l.name === layer)?.title || new URL(url).hostname;
    // A FeatureServer layer is addressed by its URL (…/FeatureServer/<id>).
    const full = kind === "arcgisfeature" && layer && !/\/\d+\/?$/.test(url) ? `${url.replace(/\/$/, "")}/${layer}` : url;
    await addRemote({ kind, name: title, url: full, layer: kind === "arcgisfeature" ? undefined : layer, matrixSet });
    url = name = "";
    layers = [];
  }
</script>

<div class="row presets">
  {#each PRESETS as p}<button onclick={() => addRemote(p)}>{p.name}</button>{/each}
</div>
<form class="stack-tight" onsubmit={add}>
  <label class="field">Type
    <select bind:value={kind} onchange={() => (layers = [])}>{#each KINDS as [k, label]}<option value={k}>{label}</option>{/each}</select>
  </label>
  <label class="field">URL
    <input type="url" required bind:value={url} placeholder={KINDS.find((k) => k[0] === kind)?.[2]} />
  </label>
  {#if needsCaps}
    <button type="button" onclick={loadCaps} disabled={!url || loading}>{loading ? "Loading…" : "Load layers"}</button>
    {#if layers.length}
      <label class="field">Layer
        <select bind:value={layer}>{#each layers as l}<option value={l.name}>{l.title}</option>{/each}</select>
      </label>
    {/if}
  {/if}
  <label class="field">Name<input bind:value={name} placeholder="Layer name (optional)" /></label>
  <button class="primary" type="submit" disabled={!url || (needsCaps && !layer)}>Add layer</button>
</form>
<p class="hint">Tiles and images are drawn by the browser; remote vector files, WFS, OGC API Features and ArcGIS feature layers are downloaded and drawn by QGIS. The QGIS engine can't fetch over the network yet (QEP #294), but the layers are saved as regular QGIS layers.</p>
