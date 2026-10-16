<script lang="ts">
  import { untrack } from "svelte";
  import { LayerType, type QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer } from "../lib/engine";
  import { apply } from "../lib/commit";
  import { child, layerSource, mapLayerEl } from "../lib/doc";
  import { crsByAuthid } from "../lib/crs";
  import { cleanDatasource } from "../lib/secrets";
  import { readForm } from "../lib/forms";
  import { flatLayers, rename, setOpacity, snapshotTree } from "../lib/tree";
  import { readScaleRange, writeScaleRange, symbolKind } from "../lib/style";
  import { rasterInfo } from "../lib/raster";
  import { scaleDenominator } from "../lib/map";
  import { remoteSpec } from "../lib/remote";
  import { ui, toast } from "../lib/state.svelte";
  import { t, N_ } from "../lib/i18n";
  import Icon from "./Icon.svelte";

  /** QGIS's Layer Properties: information, source, fields, rendering and metadata of a layer. */
  let { layerId, onclose }: { layerId: string; onclose: () => void } = $props();

  const TABS = [["info", N_("Information")], ["source", N_("Source")], ["fields", N_("Fields")], ["rendering", N_("Rendering")], ["metadata", N_("Metadata")]] as const;
  let tab = $state<(typeof TABS)[number][0]>("info");

  const info = $derived.by(() => {
    ui.version;
    const layer = findMapLayer(layerId);
    const node = flatLayers(snapshotTree()).find((l) => l.layerId === layerId)!;
    const vector = layer?.type() === LayerType.Vector ? (layer as QgsVectorLayer) : null;
    const el = mapLayerEl(layerId)!;
    const { provider, datasource } = layerSource(layerId);
    const qf = vector?.fields();
    const form = readForm(layerId);
    const e = layer ? engine().fullExtent([layerId]) : null;
    return {
      node,
      vector,
      provider,
      source: cleanDatasource(datasource),
      remote: !!remoteSpec(layerId),
      crs: layer?.crs() ?? el.querySelector(":scope > srs authid")?.textContent ?? "",
      kind: vector ? symbolKind(layerId) : null,
      count: vector && vector.featureCount() >= 0 && vector.featureCount() < 2 ** 40 ? vector.featureCount() : null,
      extent: e && e.xMaximum >= e.xMinimum ? [e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum] : null,
      fields: qf ? Array.from({ length: qf.count() }, (_, i) => qf.at(i)).map((f) => ({ name: f.name(), type: f.typeName(), length: f.length(), precision: f.precision(), alias: form.get(f.name())?.alias ?? "" })) : [],
      subset: datasource.match(/\|subset=(.*)$/)?.[1] ?? "",
      scales: readScaleRange(layerId),
      title: el.querySelector(":scope > resourceMetadata > title")?.textContent ?? "",
      abstract: el.querySelector(":scope > resourceMetadata > abstract")?.textContent ?? "",
    };
  });

  let crsName = $state("");
  $effect(() => void crsByAuthid(info.crs).then((c) => (crsName = c?.description ?? "")).catch(() => {}));
  let bands = $state<number | null>(null);
  rasterInfo(untrack(() => layerId)).then((r) => (bands = r?.bands ?? null));

  let subset = $state(untrack(() => info.subset));
  let tested = $state("");

  const fmt = (v: number) => (Math.abs(v) < 1000 ? +v.toFixed(6) : Math.round(v)).toLocaleString();
  const KINDS = { marker: N_("points"), line: N_("lines"), fill: N_("polygons") };

  /** Tries the filter in QGIS without changing the project. */
  function testSubset() {
    const layer = info.vector!;
    const before = layer.subsetString();
    tested = layer.setSubsetString(subset) ? t("{n} features match", { n: layer.featureCount() }) : t("The filter is not valid for this data source");
    layer.setSubsetString(before);
  }

  function applySubset() {
    apply(() => {
      const ds = child(mapLayerEl(layerId)!, "datasource");
      ds.textContent = ds.textContent!.replace(/\|subset=.*$/, "") + (subset.trim() ? `|subset=${subset.trim()}` : "");
    }, N_("layer filter"));
    if (!findMapLayer(layerId)?.isValid()) toast(t("The filter is not valid for this data source"));
  }

  function setAlias(field: string, alias: string) {
    apply(() => {
      const aliases = child(mapLayerEl(layerId)!, "aliases");
      let a = aliases.querySelector(`:scope > alias[field="${CSS.escape(field)}"]`);
      if (!a) a = aliases.appendChild(aliases.ownerDocument.createElement("alias"));
      a.setAttribute("field", field);
      a.setAttribute("index", String(info.fields.findIndex((f) => f.name === field)));
      a.setAttribute("name", alias);
    }, N_("field alias"));
  }

  function setMetadata(key: "title" | "abstract", value: string) {
    apply(() => (child(child(mapLayerEl(layerId)!, "resourceMetadata"), key).textContent = value), N_("layer metadata"));
  }

  const setScales = (p: Partial<typeof info.scales>) => apply(() => writeScaleRange(layerId, { ...info.scales, ...p }));
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card layer-props" role="dialog" aria-modal="true" aria-label={t("Layer properties")}>
    <header>
      <h2>{t("Layer properties")} — {info.node.name}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="tabs" role="tablist">
      {#each TABS as [id, label]}<button role="tab" aria-selected={tab === id} class:active={tab === id} onclick={() => (tab = id)}>{t(label)}</button>{/each}
    </div>

    <div class="props-body">
      {#if tab === "info"}
        <dl class="props">
          <dt>{t("Name")}</dt><dd>{info.node.name}</dd>
          <dt>{t("Type")}</dt><dd>{info.vector ? t("Vector") : info.node.layerType === LayerType.Raster ? t("Raster") : t("Web layer")}{info.kind ? ` (${t(KINDS[info.kind])})` : ""}</dd>
          <dt>{t("Provider")}</dt><dd><code>{info.provider}</code></dd>
          <dt>{t("Source")}</dt><dd class="source"><code>{info.source}</code></dd>
          <dt>{t("CRS")}</dt><dd>{info.crs}{crsName ? ` – ${crsName}` : ""}</dd>
          {#if info.extent}<dt>{t("Extent (project CRS)")}</dt><dd>{info.extent.map(fmt).join(", ")}</dd>{/if}
          {#if info.count !== null}<dt>{t("Features")}</dt><dd>{info.count.toLocaleString()}</dd>{/if}
          {#if info.vector}<dt>{t("Fields")}</dt><dd>{info.fields.length}</dd>{/if}
          {#if bands}<dt>{t("Bands")}</dt><dd>{bands}</dd>{/if}
          {#if info.subset}<dt>{t("Filter")}</dt><dd><code>{info.subset}</code></dd>{/if}
          <dt>{t("Status")}</dt><dd>{info.remote ? t("Read from the web") : info.node.valid ? t("Valid") : t("Layer data not found")}</dd>
        </dl>
      {:else if tab === "source"}
        <label class="field">{t("Layer name")}
          <input value={info.node.name} onchange={(e) => e.currentTarget.value.trim() && rename(info.node, e.currentTarget.value.trim())} />
        </label>
        <div class="field"><span>{t("Data source")}</span><code class="source">{info.source}</code></div>
        {#if info.vector && info.provider === "ogr"}
          <label class="field">{t("Provider feature filter")}
            <textarea rows="3" bind:value={subset} placeholder={`"POP_EST" > 1000000`} spellcheck="false"></textarea>
          </label>
          <p class="hint">{t("An SQL WHERE clause run by the data source (QGIS's Query Builder); only matching features are loaded.")}</p>
          <div class="row">
            <button onclick={testSubset}>{t("Test")}</button>
            <button class="primary" disabled={subset === info.subset} onclick={applySubset}>{t("Apply filter")}</button>
            {#if info.subset}<button onclick={() => ((subset = ""), applySubset())}>{t("Clear")}</button>{/if}
            <span class="muted">{tested}</span>
          </div>
        {/if}
      {:else if tab === "fields"}
        {#if info.fields.length}
          <table class="fields-table">
            <thead><tr><th>{t("Name")}</th><th>{t("Type")}</th><th>{t("Length")}</th><th>{t("Alias")}</th></tr></thead>
            <tbody>
              {#each info.fields as f (f.name)}
                <tr>
                  <td>{f.name}</td>
                  <td>{f.type}</td>
                  <td>{f.length > 0 ? `${f.length}${f.precision > 0 ? `.${f.precision}` : ""}` : ""}</td>
                  <td><input value={f.alias} aria-label={t("Alias of {field}", { field: f.name })} onchange={(e) => setAlias(f.name, e.currentTarget.value)} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="hint">{t("Aliases are shown in the attribute table and forms. Add, rename or delete fields from the attribute table.")}</p>
        {:else}
          <p class="muted">{t("This layer has no fields.")}</p>
        {/if}
      {:else if tab === "rendering"}
        <label class="field">{t("Opacity")}
          <span class="row"><input type="range" min="0" max="100" value={Math.round((info.node.opacity ?? 1) * 100)} onchange={(e) => setOpacity(info.node, e.currentTarget.valueAsNumber / 100)} /> {Math.round((info.node.opacity ?? 1) * 100)}%</span>
        </label>
        <label class="row"><input type="checkbox" checked={info.scales.enabled} onchange={(e) => setScales({ enabled: e.currentTarget.checked })} /> {t("Scale-dependent visibility")}</label>
        {#if info.scales.enabled}
          <div class="grid2 scales">
            <label class="field">{t("Hide when zoomed out beyond 1:")}
              <span class="row"><input type="number" min="0" step="any" value={info.scales.minScale || ""} placeholder={t("no limit")} onchange={(e) => setScales({ minScale: e.currentTarget.valueAsNumber || 0 })} /><button class="icon" title={t("Current map scale")} onclick={() => setScales({ minScale: Math.round(scaleDenominator()) })}><Icon name="zoom" size={15} /></button></span>
            </label>
            <label class="field">{t("Hide when zoomed in beyond 1:")}
              <span class="row"><input type="number" min="0" step="any" value={info.scales.maxScale || ""} placeholder={t("no limit")} onchange={(e) => setScales({ maxScale: e.currentTarget.valueAsNumber || 0 })} /><button class="icon" title={t("Current map scale")} onclick={() => setScales({ maxScale: Math.round(scaleDenominator()) })}><Icon name="zoom" size={15} /></button></span>
            </label>
          </div>
        {/if}
        <button class="link" onclick={() => { ui.panel = "style"; onclose(); }}>{t("Symbology, labels, popups and time are in the Style panel")}</button>
      {:else}
        <label class="field">{t("Title")}<input value={info.title} onchange={(e) => setMetadata("title", e.currentTarget.value)} /></label>
        <label class="field">{t("Abstract")}<textarea rows="5" value={info.abstract} onchange={(e) => setMetadata("abstract", e.currentTarget.value)}></textarea></label>
        <p class="hint">{t("Saved as the layer's QGIS metadata.")}</p>
      {/if}
    </div>
  </div>
</div>
