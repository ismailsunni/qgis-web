<script lang="ts">
  import { LayerType, type QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer } from "../lib/engine";
  import { ui } from "../lib/state.svelte";

  const info = $derived.by(() => {
    ui.version;
    const layer = ui.current && ui.phase === "ready" ? findMapLayer(ui.current) : null;
    if (!layer) return null;
    const vector = layer.type() === LayerType.Vector ? (layer as QgsVectorLayer) : null;
    return {
      name: layer.name,
      crs: layer.crs(),
      type: LayerType[layer.type()],
      features: vector?.featureCount(),
      fields: vector ? Array.from({ length: vector.fields().count() }, (_, i) => vector.fields().at(i).name()) : [],
      legend: findLegend(ui.current!),
    };
  });

  function findLegend(id: string) {
    return (engine().layerTreeRoot().findLayer(id)?.legendNodes() ?? []).map((l) => ({ label: l.label(), icon: l.symbolImage(20) }));
  }
</script>

{#if !info}
  <p class="muted">Select a layer in the Layers panel.</p>
{:else}
  <section class="stack">
    <h3>{info.name}</h3>
    <dl class="props">
      <dt>Type</dt><dd>{info.type}</dd>
      <dt>CRS</dt><dd>{info.crs}</dd>
      {#if info.features !== undefined}<dt>Features</dt><dd>{info.features.toLocaleString()}</dd>{/if}
    </dl>
  </section>
  <section class="stack">
    <h3>Symbology</h3>
    <ul class="legend big">
      {#each info.legend as item}
        <li>{#if item.icon}<img src={item.icon} alt="" />{/if}<span>{item.label || info.name}</span></li>
      {/each}
    </ul>
    <p class="hint">
      Editing symbology and labels (single, categorized, graduated, QML import/export) is milestone M2 and needs the
      QgsFeatureRenderer / QgsPalLayerSettings bindings in qgis-js.
    </p>
  </section>
  {#if info.fields.length}
    <section class="stack">
      <h3>Fields</h3>
      <p class="fields">{#each info.fields as f}<code>{f}</code>{/each}</p>
    </section>
  {/if}
{/if}
