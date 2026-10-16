<script lang="ts">
  import { LayerType, type QgsVectorLayer } from "qgis-js";
  import { findMapLayer } from "../lib/engine";
  import { apply } from "../lib/commit";
  import { ui, toast } from "../lib/state.svelte";
  import * as S from "../lib/style";
  import Icon from "./Icon.svelte";
  import ExpressionInput from "./ExpressionInput.svelte";

  const FONTS = ["Open Sans", "Noto Sans", "DejaVu Sans", "Arial", "Helvetica", "Roboto", "Liberation Sans", "Times New Roman", "Georgia"];

  const info = $derived.by(() => {
    ui.version;
    const id = ui.current;
    const layer = id && ui.phase === "ready" ? findMapLayer(id) : null;
    if (!id || !layer) return null;
    const vector = layer.type() === LayerType.Vector ? (layer as QgsVectorLayer) : null;
    const fields = vector ? Array.from({ length: vector.fields().count() }, (_, i) => vector.fields().at(i)) : [];
    return {
      id,
      name: layer.name,
      crs: layer.crs(),
      type: LayerType[layer.type()],
      vector: !!vector,
      kind: vector ? S.symbolKind(id) : null,
      // Some providers (delimited text) report an unknown count as an out-of-range value.
      features: vector && vector.featureCount() >= 0 && vector.featureCount() < 2 ** 40 ? vector.featureCount() : undefined,
      fields: fields.map((f) => f.name()),
      numeric: fields.filter((f) => [2, 4, 6, 3, 5, 32, 33, 34, 35, 36, 38].includes(f.type())).map((f) => f.name()),
      renderer: vector ? S.readRenderer(id) : null,
      labels: vector ? S.readLabels(id) : null,
      legend: [] as { label: string; icon: string }[],
    };
  });

  const base = $derived(info?.renderer?.base ? S.readSymbol(info.renderer.base) : null);
  let catField = $state("");
  let ramp = $state("Pastel");
  let gradRamp = $state("YlOrRd");
  let mode = $state("Jenks");
  let classes = $state(5);
  let advanced = $state(false);
  let qml = $state("");

  $effect(() => {
    if (!info?.renderer) return;
    catField = info.renderer.attr || info.fields[0] || "";
    if (info.renderer.ramp) info.renderer.type === "graduatedSymbol" ? (gradRamp = info.renderer.ramp) : (ramp = info.renderer.ramp);
    if (info.renderer.type === "graduatedSymbol") mode = info.renderer.mode;
  });

  function setType(type: string) {
    const id = info!.id;
    if (type === "singleSymbol") apply(() => S.setSingle(id));
    else if (type === "categorizedSymbol") {
      const field = info!.fields.includes(catField) ? catField : info!.fields[0];
      apply(() => S.setCategorized(id, field, S.uniqueCategories(id, field, ramp), ramp));
    } else if (type === "graduatedSymbol") {
      const field = info!.numeric.includes(catField) ? catField : (info!.numeric.find((f) => f !== "fid") ?? info!.numeric[0]);
      if (!field) return toast("This layer has no numeric field to graduate on.");
      apply(() => S.setGraduated(id, field, S.classify(id, field, mode, classes, gradRamp), gradRamp, mode));
    }
  }

  const reclassify = () => setType(info!.renderer!.type);

  function symbolProp(p: Partial<S.SymbolProps>) {
    const id = info!.id;
    apply(() => (info!.renderer!.type === "singleSymbol" ? S.setAllSymbols(id, p) : S.setAllSymbols(id, { ...p, color: undefined })));
  }

  function labels(p: Partial<S.LabelProps>) {
    const id = info!.id;
    const cur = info!.labels!;
    const next = { ...cur, ...p };
    if (!next.field) next.field = info!.fields[0] ?? "";
    if (p.enabled && !cur.enabled && !cur.field) next.placement = S.PLACEMENTS[info!.kind ?? "fill"][0][0];
    apply(() => S.writeLabels(id, next));
  }

  function openAdvanced() {
    advanced = !advanced;
    if (advanced) qml = S.exportQml(info!.id);
  }

  function applyQml(text: string) {
    const id = info!.id;
    apply(() => S.importQml(id, text), "apply QML");
    qml = S.exportQml(id);
  }

  async function importFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) applyQml(await file.text());
    (e.currentTarget as HTMLInputElement).value = "";
  }

  function exportFile() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([S.exportQml(info!.id)], { type: "application/xml" }));
    a.download = `${info!.name}.qml`;
    a.click();
  }
</script>

{#if !info}
  <p class="muted pad">Select a layer in the Layers panel.</p>
{:else}
  <section class="stack">
    <h3>{info.name}</h3>
    <dl class="props">
      <dt>Type</dt><dd>{info.type}{info.kind ? ` (${{ marker: "points", line: "lines", fill: "polygons" }[info.kind]})` : ""}</dd>
      <dt>CRS</dt><dd>{info.crs || "unknown"}</dd>
      {#if info.features !== undefined}<dt>Features</dt><dd>{info.features.toLocaleString()}</dd>{/if}
    </dl>
  </section>

  {#if info.renderer}
    {@const r = info.renderer}
    <section class="stack">
      <h3>Symbology</h3>
      {#if ["singleSymbol", "categorizedSymbol", "graduatedSymbol", "none"].includes(r.type)}
        <label class="field">Type
          <select value={r.type} onchange={(e) => setType(e.currentTarget.value)}>
            <option value="singleSymbol">Single symbol</option>
            <option value="categorizedSymbol">Categorized</option>
            <option value="graduatedSymbol">Graduated</option>
            {#if r.type === "none"}<option value="none">Default</option>{/if}
          </select>
        </label>
      {:else}
        <p class="hint">This layer uses a <b>{r.type}</b> renderer. Edit it with QML under Advanced, or switch to:</p>
        <div class="row">
          <button onclick={() => setType("singleSymbol")}>Single</button>
          <button onclick={() => setType("categorizedSymbol")}>Categorized</button>
          <button onclick={() => setType("graduatedSymbol")}>Graduated</button>
        </div>
      {/if}

      {#if base && ["singleSymbol", "categorizedSymbol", "graduatedSymbol"].includes(r.type)}
        <div class="grid2">
          {#if r.type === "singleSymbol" && base.cls}
            <label class="field">{base.kind === "line" ? "Color" : "Fill"}<input type="color" value={base.color} onchange={(e) => symbolProp({ color: e.currentTarget.value })} /></label>
          {/if}
          {#if base.kind !== "line" && ["SimpleFill", "SimpleMarker"].includes(base.cls)}
            <label class="field">Stroke<input type="color" value={base.stroke} onchange={(e) => symbolProp({ stroke: e.currentTarget.value })} /></label>
            <label class="field">Stroke width (mm)<input type="number" min="0" step="0.1" value={base.strokeWidth} onchange={(e) => symbolProp({ strokeWidth: e.currentTarget.valueAsNumber })} /></label>
          {/if}
          {#if base.kind !== "fill" && ["SimpleLine", "SimpleMarker"].includes(base.cls)}
            <label class="field">{base.kind === "line" ? "Width" : "Size"} (mm)<input type="number" min="0" step="0.1" value={base.size} onchange={(e) => symbolProp({ size: e.currentTarget.valueAsNumber })} /></label>
          {/if}
          <label class="field">Opacity<input type="range" min="0" max="1" step="0.05" value={base.opacity} onchange={(e) => symbolProp({ opacity: e.currentTarget.valueAsNumber })} /></label>
        </div>
        {#if !["SimpleFill", "SimpleLine", "SimpleMarker"].includes(base.cls)}<p class="hint">Symbol layer type {base.cls}: some options are only editable as QML.</p>{/if}
      {/if}

      {#if r.type === "categorizedSymbol"}
        <label class="field">Value
          <ExpressionInput layerId={info.id} value={catField} fields={info.fields} onchange={(v) => (catField = v)} />
        </label>
        <div class="row">
          <select bind:value={ramp} aria-label="Color ramp">{#each Object.keys(S.RAMPS) as name}<option>{name}</option>{/each}</select>
          <button onclick={reclassify}>Classify</button>
        </div>
        <ul class="classes">
          {#each r.categories as c, i}
            <li>
              <input type="checkbox" checked={c.render} aria-label="Show" onchange={(e) => apply(() => S.setClassAttr(info.id, i, "render", String(e.currentTarget.checked)))} />
              <input type="color" value={c.color} onchange={(e) => apply(() => S.setClassColor(info.id, i, e.currentTarget.value))} />
              <input value={c.label} aria-label="Label" onchange={(e) => apply(() => S.setClassAttr(info.id, i, "label", e.currentTarget.value))} />
            </li>
          {/each}
        </ul>
      {:else if r.type === "graduatedSymbol"}
        <label class="field">Value
          <select bind:value={catField}>{#each info.numeric as f}<option>{f}</option>{/each}</select>
        </label>
        <div class="grid2">
          <label class="field">Mode<select bind:value={mode}>{#each Object.entries(S.MODES) as [k, v]}<option value={k}>{v}</option>{/each}</select></label>
          <label class="field">Classes<input type="number" min="2" max="20" bind:value={classes} /></label>
          <label class="field">Ramp<select bind:value={gradRamp}>{#each Object.keys(S.RAMPS) as name}<option>{name}</option>{/each}</select></label>
          <div class="field"><span>&nbsp;</span><button onclick={reclassify}>Classify</button></div>
        </div>
        <ul class="classes">
          {#each r.ranges as g, i}
            <li>
              <input type="checkbox" checked={g.render} aria-label="Show" onchange={(e) => apply(() => S.setClassAttr(info.id, i, "render", String(e.currentTarget.checked)))} />
              <input type="color" value={g.color} onchange={(e) => apply(() => S.setClassColor(info.id, i, e.currentTarget.value))} />
              <input value={g.label} aria-label="Label" onchange={(e) => apply(() => S.setClassAttr(info.id, i, "label", e.currentTarget.value))} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if info.labels && info.kind}
    {@const l = info.labels}
    <section class="stack">
      <label class="row"><input type="checkbox" checked={l.enabled} onchange={(e) => labels({ enabled: e.currentTarget.checked })} /> <h3>Labels</h3></label>
      {#if !l.simple}
        <p class="hint">This layer uses rule-based labels; edit them as QML under Advanced. Editing here replaces them with simple labels.</p>
      {/if}
      {#if l.enabled}
        <label class="field">Label with
          <ExpressionInput layerId={info.id} value={l.isExpression ? l.field : l.field} fields={info.fields} onchange={(v) => labels({ field: v, isExpression: !info.fields.includes(v) })} />
        </label>
        <div class="grid2">
          <label class="field">Font<input list="fonts" value={l.font} onchange={(e) => labels({ font: e.currentTarget.value })} /></label>
          <label class="field">Size (pt)<input type="number" min="1" step="0.5" value={l.size} onchange={(e) => labels({ size: e.currentTarget.valueAsNumber })} /></label>
          <label class="field">Color<input type="color" value={l.color} onchange={(e) => labels({ color: e.currentTarget.value })} /></label>
          <label class="field">Placement
            <select value={l.placement} onchange={(e) => labels({ placement: +e.currentTarget.value })}>
              {#each S.PLACEMENTS[info.kind] as [v, name]}<option value={v}>{name}</option>{/each}
            </select>
          </label>
          <label class="field row-inline"><input type="checkbox" checked={l.buffer} onchange={(e) => labels({ buffer: e.currentTarget.checked })} /> Buffer</label>
          {#if l.buffer}
            <label class="field">Buffer size (mm)<input type="number" min="0" step="0.1" value={l.bufferSize} onchange={(e) => labels({ bufferSize: e.currentTarget.valueAsNumber })} /></label>
            <label class="field">Buffer color<input type="color" value={l.bufferColor} onchange={(e) => labels({ bufferColor: e.currentTarget.value })} /></label>
          {/if}
        </div>
        <datalist id="fonts">{#each FONTS as f}<option value={f}></option>{/each}</datalist>
        <p class="hint">The font is saved for QGIS Desktop; the browser preview uses the engine's built-in font.</p>
      {/if}
    </section>
  {/if}

  {#if info.vector}
    {@const popup = S.readPopup(info.id)}
    <section class="stack">
      <h3>Popup</h3>
      <label class="field">Display name
        <ExpressionInput layerId={info.id} value={popup.display} fields={info.fields} placeholder="Field or expression used as the title" onchange={(v) => apply(() => S.writePopup(info.id, { ...popup, display: v }), "popup title")} />
      </label>
      <label class="field">Map tip (HTML with [% expression %])
        <textarea class="code small" value={popup.mapTip} placeholder="Shown in Identify and on hover when map tips are on" onchange={(e) => apply(() => S.writePopup(info.id, { ...popup, mapTip: e.currentTarget.value }), "map tip")}></textarea>
      </label>
      {#if !popup.mapTip}<button class="link" onclick={() => apply(() => S.writePopup(info.id, { ...popup, mapTip: S.defaultMapTip(info.fields) }), "map tip")}>Start from all fields</button>{/if}
      <p class="hint">Saved in the project like QGIS's Display properties.</p>
    </section>
  {/if}

  <section class="stack">
    <div class="row">
      <button class="ghost" onclick={openAdvanced}><span class="chev" class:open={advanced}><Icon name="chevron" size={14} /></span> Advanced (QML)</button>
    </div>
    <div class="row">
      <label class="button-like"><Icon name="upload" size={16} /> Load QML…<input type="file" accept=".qml,.xml" hidden onchange={importFile} /></label>
      <button onclick={exportFile}><Icon name="download" size={16} /> Save QML</button>
    </div>
    {#if advanced}
      <textarea class="code" bind:value={qml} spellcheck="false"></textarea>
      <button class="primary" onclick={() => applyQml(qml)}>Apply QML</button>
      <p class="hint">Any QGIS style can be pasted here: rule-based renderers, data-defined properties, diagrams… QGIS applies it as is.</p>
    {/if}
  </section>
{/if}
