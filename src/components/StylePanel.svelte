<script lang="ts">
  import { LayerType, type QgsVectorLayer } from "qgis-js";
  import { findMapLayer } from "../lib/engine";
  import { apply } from "../lib/commit";
  import { ui, toast } from "../lib/state.svelte";
  import * as S from "../lib/style";
  import Icon from "./Icon.svelte";
  import ExpressionInput from "./ExpressionInput.svelte";
  import RasterStyle from "./RasterStyle.svelte";
  import { scaleDenominator } from "../lib/map";
  import { readTemporal, writeTemporal } from "../lib/temporal";
  import { t } from "../lib/i18n";

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
      scales: S.readScaleRange(id),
      temporal: vector ? readTemporal(id) : null,
      // QMetaType ids of date/time and text fields (text may hold ISO dates).
      timeFields: [...fields.filter((f) => [14, 15, 16].includes(f.type())), ...fields.filter((f) => f.type() === 10)].map((f) => f.name()),
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
      if (!field) return toast(t("This layer has no numeric field to graduate on."));
      apply(() => S.setGraduated(id, field, S.classify(id, field, mode, classes, gradRamp), gradRamp, mode));
    }
  }

  const reclassify = () => setType(info!.renderer!.type);

  // One-click styles for a plain layer: categories for a text field with few values, classes for a number.
  const suggestions = $derived(info?.renderer && ["singleSymbol", "none"].includes(info.renderer.type) ? S.suggestStyles(info.id) : []);
  function suggest(s: S.Suggestion) {
    catField = s.field;
    setType(s.type);
  }

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
  <p class="muted pad">{t("Select a layer in the Layers panel.")}</p>
{:else}
  <section class="stack">
    <h3>{info.name}</h3>
    <dl class="props">
      <dt>{t("Type")}</dt><dd>{info.type}{info.kind ? ` (${{ marker: t("points"), line: t("lines"), fill: t("polygons") }[info.kind]})` : ""}</dd>
      <dt>CRS</dt><dd>{info.crs || t("unknown")}</dd>
      {#if info.features !== undefined}<dt>{t("Features")}</dt><dd>{info.features.toLocaleString()}</dd>{/if}
    </dl>
  </section>

  {@const sr = info.scales}
  {@const set = (p: Partial<typeof sr>) => apply(() => S.writeScaleRange(info.id, { ...sr, ...p }))}
  <section class="stack">
    <label class="row"><input type="checkbox" checked={sr.enabled} onchange={(e) => set({ enabled: e.currentTarget.checked })} /> <h3>{t("Scale-dependent visibility")}</h3></label>
    {#if sr.enabled}
      <div class="grid2 scales">
        <label class="field">{t("Hide when zoomed out beyond 1:")}
          <span class="row"><input type="number" min="0" step="any" value={sr.minScale || ""} placeholder={t("no limit")} onchange={(e) => set({ minScale: e.currentTarget.valueAsNumber || 0 })} /><button class="icon" title={t("Current map scale")} aria-label={t("Use current scale as minimum")} onclick={() => set({ minScale: Math.round(scaleDenominator()) })}><Icon name="zoom" size={15} /></button></span>
        </label>
        <label class="field">{t("Hide when zoomed in beyond 1:")}
          <span class="row"><input type="number" min="0" step="any" value={sr.maxScale || ""} placeholder={t("no limit")} onchange={(e) => set({ maxScale: e.currentTarget.valueAsNumber || 0 })} /><button class="icon" title={t("Current map scale")} aria-label={t("Use current scale as maximum")} onclick={() => set({ maxScale: Math.round(scaleDenominator()) })}><Icon name="zoom" size={15} /></button></span>
        </label>
      </div>
    {/if}
  </section>

  {#if info.temporal && info.timeFields.length}
    {@const tm = info.temporal}
    {@const setT = (p: Partial<typeof tm>) => apply(() => writeTemporal(info.id, { ...tm, start: tm.start || info.timeFields[0], ...p }), "temporal settings")}
    <section class="stack">
      <label class="row"><input type="checkbox" checked={tm.enabled} onchange={(e) => setT({ enabled: e.currentTarget.checked })} /> <h3>{t("Time (temporal controller)")}</h3></label>
      {#if tm.enabled}
        <label class="field">{t("Features have")}
          <select value={tm.mode} onchange={(e) => setT({ mode: +e.currentTarget.value as 1 | 2, end: tm.end || info.timeFields[0] })}><option value={1}>{t("A date/time (one field)")}</option><option value={2}>{t("Start and end fields")}</option></select>
        </label>
        <div class="grid2">
          <label class="field">{tm.mode === 2 ? t("Start") : t("Date/time")}<select value={tm.start} onchange={(e) => setT({ start: e.currentTarget.value })}>{#each info.timeFields as f}<option>{f}</option>{/each}</select></label>
          {#if tm.mode === 2}<label class="field">{t("End")}<select value={tm.end} onchange={(e) => setT({ end: e.currentTarget.value })}>{#each info.timeFields as f}<option>{f}</option>{/each}</select></label>{/if}
        </div>
        {#if tm.mode === 1}<label class="row"><input type="checkbox" checked={tm.accumulate} onchange={(e) => setT({ accumulate: e.currentTarget.checked })} /> {t("Accumulate features over time")}</label>{/if}
        <p class="hint">{t("Use the clock button on the map to play through time.")}</p>
      {/if}
    </section>
  {/if}

  {#if info.type === "Raster"}
    {#key info.id}<RasterStyle layerId={info.id} />{/key}
  {/if}

  {#if info.renderer}
    {@const r = info.renderer}
    <section class="stack">
      <h3>{t("Symbology")}</h3>
      {#if ["singleSymbol", "categorizedSymbol", "graduatedSymbol", "RuleRenderer", "heatmapRenderer", "pointCluster", "none"].includes(r.type)}
        <label class="field">{t("Type")}
          <select value={r.type} onchange={(e) => setType(e.currentTarget.value)}>
            <option value="singleSymbol">{t("Single symbol")}</option>
            <option value="categorizedSymbol">{t("Categorized")}</option>
            <option value="graduatedSymbol">{t("Graduated")}</option>
            <option value="RuleRenderer">{t("Rule-based")}</option>
            {#if info.kind === "marker"}
              <option value="heatmapRenderer">{t("Heatmap")}</option>
              <option value="pointCluster">{t("Point clusters")}</option>
            {/if}
            {#if r.type === "none"}<option value="none">{t("Default")}</option>{/if}
          </select>
        </label>
        {#if suggestions.length}
          <div class="suggestions">
            <span class="muted">{t("Try:")}</span>
            {#each suggestions as s}
              <button class="chip" onclick={() => suggest(s)}>{s.type === "categorizedSymbol" ? t("Categorized by {field}", { field: s.field }) : t("Graduated by {field}", { field: s.field })}</button>
            {/each}
          </div>
        {/if}
      {:else}
        {@const msg = t("This layer uses a {renderer} renderer. Edit it with QML under Advanced, or switch to:").split("{renderer}")}
        <p class="hint">{msg[0]}<b>{r.type}</b>{msg[1]}</p>
        <div class="row">
          <button onclick={() => setType("singleSymbol")}>{t("Single")}</button>
          <button onclick={() => setType("categorizedSymbol")}>{t("Categorized")}</button>
          <button onclick={() => setType("RuleRenderer")}>{t("Rule-based")}</button>
        </div>
      {/if}

      {#if r.type === "RuleRenderer"}
        {@const rules = S.readRules(info.id)}
        <ul class="rules">
          {#each rules as rule, i}
            <li>
              <div class="row">
                <input type="checkbox" checked={rule.enabled} aria-label={t("Show")} onchange={(e) => apply(() => S.setRule(info.id, i, { enabled: e.currentTarget.checked }), "rule")} />
                <input type="color" value={rule.color} onchange={(e) => apply(() => S.setRule(info.id, i, { color: e.currentTarget.value }), "rule color")} />
                <input value={rule.label} aria-label={t("Label")} onchange={(e) => apply(() => S.setRule(info.id, i, { label: e.currentTarget.value }), "rule label")} />
                <button class="icon" title={t("Remove rule")} aria-label={t("Remove rule")} onclick={() => apply(() => S.removeRule(info.id, i), "remove rule")}><Icon name="trash" size={15} /></button>
              </div>
              <ExpressionInput layerId={info.id} value={rule.filter} fields={info.fields} placeholder={t("Filter (empty: all features, ELSE: the rest)")} onchange={(v) => apply(() => S.setRule(info.id, i, { filter: v }), "rule filter")} />
              <div class="row scales">
                <label>1:<input type="number" min="0" placeholder={t("no limit")} value={rule.minScale || ""} title={t("Hidden when zoomed out beyond this scale")} onchange={(e) => apply(() => S.setRule(info.id, i, { minScale: e.currentTarget.valueAsNumber || 0 }), "rule scale")} /></label>
                <span class="muted">{t("to")}</span>
                <label>1:<input type="number" min="0" placeholder={t("no limit")} value={rule.maxScale || ""} title={t("Hidden when zoomed in beyond this scale")} onchange={(e) => apply(() => S.setRule(info.id, i, { maxScale: e.currentTarget.valueAsNumber || 0 }), "rule scale")} /></label>
              </div>
              {#if rule.nested}<p class="hint">{t("Has nested rules (edit them as QML).")}</p>{/if}
            </li>
          {/each}
        </ul>
        <button onclick={() => apply(() => S.addRule(info.id), "add rule")}><Icon name="add" size={16} /> {t("Add rule")}</button>
      {:else if r.type === "heatmapRenderer"}
        {@const h = S.readHeatmap(info.id)}
        <div class="grid2">
          <label class="field">{t("Radius (mm)")}<input type="number" min="1" step="1" value={h.radius} onchange={(e) => apply(() => S.setHeatmap(info.id, { radius: e.currentTarget.valueAsNumber }), "heatmap radius")} /></label>
          <label class="field">{t("Colors")}<select value={h.ramp} onchange={(e) => apply(() => S.setHeatmap(info.id, { ramp: e.currentTarget.value }), "heatmap colors")}>{#each Object.keys(S.RAMPS).filter((n) => !S.RAMPS[n].qualitative) as name}<option>{name}</option>{/each}</select></label>
          <label class="field">{t("Maximum (0 = automatic)")}<input type="number" min="0" value={h.maxValue} onchange={(e) => apply(() => S.setHeatmap(info.id, { maxValue: e.currentTarget.valueAsNumber || 0 }), "heatmap maximum")} /></label>
        </div>
        <label class="field">{t("Weight points by")}
          <ExpressionInput layerId={info.id} value={h.weight} fields={info.fields} placeholder={t("(equal weights)")} onchange={(v) => apply(() => S.setHeatmap(info.id, { weight: v }), "heatmap weight")} />
        </label>
      {:else if r.type === "pointCluster"}
        <label class="field">{t("Cluster points closer than (mm)")}<input type="number" min="0.5" step="0.5" value={S.clusterTolerance(info.id)} onchange={(e) => { const t = e.currentTarget.valueAsNumber; apply(() => S.setCluster(info.id, t), "cluster distance"); }} /></label>
        <p class="hint">{t("Points outside clusters keep the layer's previous symbology (editable as QML).")}</p>
      {/if}

      {#if base && ["singleSymbol", "categorizedSymbol", "graduatedSymbol"].includes(r.type)}
        <div class="grid2">
          {#if r.type === "singleSymbol" && base.cls}
            <label class="field">{base.kind === "line" ? t("Color") : t("Fill")}<input type="color" value={base.color} onchange={(e) => symbolProp({ color: e.currentTarget.value })} /></label>
          {/if}
          {#if base.kind !== "line" && ["SimpleFill", "SimpleMarker"].includes(base.cls)}
            <label class="field">{t("Stroke")}<input type="color" value={base.stroke} onchange={(e) => symbolProp({ stroke: e.currentTarget.value })} /></label>
            <label class="field">{t("Stroke width (mm)")}<input type="number" min="0" step="0.1" value={base.strokeWidth} onchange={(e) => symbolProp({ strokeWidth: e.currentTarget.valueAsNumber })} /></label>
          {/if}
          {#if base.kind !== "fill" && ["SimpleLine", "SimpleMarker"].includes(base.cls)}
            <label class="field">{base.kind === "line" ? t("Width (mm)") : t("Size (mm)")}<input type="number" min="0" step="0.1" value={base.size} onchange={(e) => symbolProp({ size: e.currentTarget.valueAsNumber })} /></label>
          {/if}
          <label class="field">{t("Opacity")}<input type="range" min="0" max="1" step="0.05" value={base.opacity} onchange={(e) => symbolProp({ opacity: e.currentTarget.valueAsNumber })} /></label>
        </div>
        {#if !["SimpleFill", "SimpleLine", "SimpleMarker"].includes(base.cls)}<p class="hint">{t("Symbol layer type {type}: some options are only editable as QML.", { type: base.cls })}</p>{/if}
      {/if}

      {#if r.type === "categorizedSymbol"}
        <label class="field">{t("Value")}
          <ExpressionInput layerId={info.id} value={catField} fields={info.fields} onchange={(v) => (catField = v)} />
        </label>
        <div class="row">
          <select bind:value={ramp} aria-label={t("Color ramp")}>{#each Object.keys(S.RAMPS) as name}<option>{name}</option>{/each}</select>
          <button onclick={reclassify}>{t("Classify")}</button>
        </div>
        <ul class="classes">
          {#each r.categories as c, i}
            <li>
              <input type="checkbox" checked={c.render} aria-label={t("Show")} onchange={(e) => apply(() => S.setClassAttr(info.id, i, "render", String(e.currentTarget.checked)))} />
              <input type="color" value={c.color} onchange={(e) => apply(() => S.setClassColor(info.id, i, e.currentTarget.value))} />
              <input value={c.label} aria-label={t("Label")} onchange={(e) => apply(() => S.setClassAttr(info.id, i, "label", e.currentTarget.value))} />
            </li>
          {/each}
        </ul>
      {:else if r.type === "graduatedSymbol"}
        <label class="field">{t("Value")}
          <select bind:value={catField}>{#each info.numeric as f}<option>{f}</option>{/each}</select>
        </label>
        <div class="grid2">
          <label class="field">{t("Mode")}<select bind:value={mode}>{#each Object.entries(S.MODES) as [k, v]}<option value={k}>{t(v)}</option>{/each}</select></label>
          <label class="field">{t("Classes")}<input type="number" min="2" max="20" bind:value={classes} /></label>
          <label class="field">{t("Ramp")}<select bind:value={gradRamp}>{#each Object.keys(S.RAMPS) as name}<option>{name}</option>{/each}</select></label>
          <div class="field"><span>&nbsp;</span><button onclick={reclassify}>{t("Classify")}</button></div>
        </div>
        <ul class="classes">
          {#each r.ranges as g, i}
            <li>
              <input type="checkbox" checked={g.render} aria-label={t("Show")} onchange={(e) => apply(() => S.setClassAttr(info.id, i, "render", String(e.currentTarget.checked)))} />
              <input type="color" value={g.color} onchange={(e) => apply(() => S.setClassColor(info.id, i, e.currentTarget.value))} />
              <input value={g.label} aria-label={t("Label")} onchange={(e) => apply(() => S.setClassAttr(info.id, i, "label", e.currentTarget.value))} />
              {#if i < r.ranges.length - 1}<input class="break" type="number" step="any" value={g.upper} aria-label={t("Upper bound")} title={t("Upper bound (manual break)")} onchange={(e) => apply(() => S.setBreak(info.id, i, e.currentTarget.valueAsNumber))} />{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if info.labels && info.kind}
    {@const l = info.labels}
    <section class="stack">
      <label class="row"><input type="checkbox" checked={l.enabled} onchange={(e) => labels({ enabled: e.currentTarget.checked })} /> <h3>{t("Labels")}</h3></label>
      {#if !l.simple}
        <p class="hint">{t("This layer uses rule-based labels; edit them as QML under Advanced. Editing here replaces them with simple labels.")}</p>
      {/if}
      {#if l.enabled}
        <label class="field">{t("Label with")}
          <ExpressionInput layerId={info.id} value={l.isExpression ? l.field : l.field} fields={info.fields} onchange={(v) => labels({ field: v, isExpression: !info.fields.includes(v) })} />
        </label>
        <div class="grid2">
          <label class="field">{t("Font")}<input list="fonts" value={l.font} onchange={(e) => labels({ font: e.currentTarget.value })} /></label>
          <label class="field">{t("Size (pt)")}<input type="number" min="1" step="0.5" value={l.size} onchange={(e) => labels({ size: e.currentTarget.valueAsNumber })} /></label>
          <label class="field">{t("Color")}<input type="color" value={l.color} onchange={(e) => labels({ color: e.currentTarget.value })} /></label>
          <label class="field">{t("Placement")}
            <select value={l.placement} onchange={(e) => labels({ placement: +e.currentTarget.value })}>
              {#each S.PLACEMENTS[info.kind] as [v, name]}<option value={v}>{t(name)}</option>{/each}
            </select>
          </label>
          <label class="field row-inline"><input type="checkbox" checked={l.buffer} onchange={(e) => labels({ buffer: e.currentTarget.checked })} /> {t("Buffer")}</label>
          {#if l.buffer}
            <label class="field">{t("Buffer size (mm)")}<input type="number" min="0" step="0.1" value={l.bufferSize} onchange={(e) => labels({ bufferSize: e.currentTarget.valueAsNumber })} /></label>
            <label class="field">{t("Buffer color")}<input type="color" value={l.bufferColor} onchange={(e) => labels({ bufferColor: e.currentTarget.value })} /></label>
          {/if}
        </div>
        <datalist id="fonts">{#each FONTS as f}<option value={f}></option>{/each}</datalist>
        <p class="hint">{t("The font is saved for QGIS Desktop; the browser preview uses the engine's built-in font.")}</p>
      {/if}
    </section>
  {/if}

  {#if info.vector}
    {@const popup = S.readPopup(info.id)}
    <section class="stack">
      <h3>{t("Popup")}</h3>
      <label class="field">{t("Display name")}
        <ExpressionInput layerId={info.id} value={popup.display} fields={info.fields} placeholder={t("Field or expression used as the title")} onchange={(v) => apply(() => S.writePopup(info.id, { ...popup, display: v }), "popup title")} />
      </label>
      <label class="field">{t("Map tip (HTML with [% expression %])")}
        <textarea class="code small" value={popup.mapTip} placeholder={t("Shown in Identify and on hover when map tips are on")} onchange={(e) => apply(() => S.writePopup(info.id, { ...popup, mapTip: e.currentTarget.value }), "map tip")}></textarea>
      </label>
      {#if !popup.mapTip}<button class="link" onclick={() => apply(() => S.writePopup(info.id, { ...popup, mapTip: S.defaultMapTip(info.fields) }), "map tip")}>{t("Start from all fields")}</button>{/if}
      <p class="hint">{t("Saved in the project like QGIS's Display properties.")}</p>
    </section>
  {/if}

  <section class="stack">
    <div class="row">
      <button class="ghost" onclick={openAdvanced}><span class="chev" class:open={advanced}><Icon name="chevron" size={14} /></span> {t("Advanced (QML)")}</button>
    </div>
    <div class="row">
      <label class="button-like"><Icon name="upload" size={16} /> {t("Load QML…")}<input type="file" accept=".qml,.xml" hidden onchange={importFile} /></label>
      <button onclick={exportFile}><Icon name="download" size={16} /> {t("Save QML")}</button>
    </div>
    {#if advanced}
      <textarea class="code" bind:value={qml} spellcheck="false"></textarea>
      <button class="primary" onclick={() => applyQml(qml)}>{t("Apply QML")}</button>
      <p class="hint">{t("Any QGIS style can be pasted here: rule-based renderers, data-defined properties, diagrams… QGIS applies it as is.")}</p>
    {/if}
  </section>
{/if}
