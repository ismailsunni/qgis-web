<script lang="ts">
  import { untrack } from "svelte";
  import type { QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer, free } from "../lib/engine";
  import { ensureEditing, writeField, type FieldType } from "../lib/editing";
  import { ui, toast } from "../lib/state.svelte";
  import ExpressionInput from "./ExpressionInput.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n";

  let props: { layerId: string; onclose: () => void } = $props();
  const layerId = untrack(() => props.layerId);
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const fields = Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i).name());
  const count = (ui.selection[layerId] ?? []).length;

  let create = $state(true);
  let name = $state("");
  let type = $state<FieldType>("REAL");
  let target = $state(fields.find((f) => f !== "fid") ?? "");
  let expression = $state("");
  let onlySelected = $state(count > 0);
  let busy = $state(false);

  /** Evaluates the expression with QGIS for each feature. */
  function evaluate(limit?: number) {
    const api = engine();
    const e = new api.QgsExpression(expression);
    if (e.hasParserError()) {
      const msg = e.parserErrorString();
      free(e);
      throw new Error(msg);
    }
    const req = new api.QgsFeatureRequest();
    if (onlySelected && count) req.setFilterFids(ui.selection[layerId]);
    if (limit) req.setLimit(limit);
    const ctx = layer.createExpressionContext();
    const it = layer.getFeatures(req);
    const values = new Map<number, unknown>();
    for (let f = it.nextFeature(); f; f = it.nextFeature()) {
      ctx.setFeature(f);
      values.set(f.id(), e.evaluate(ctx));
      free(f);
    }
    for (const o of [it, req, ctx, e]) free(o);
    return values;
  }

  const preview = $derived.by(() => {
    if (!expression.trim()) return "";
    try {
      const [v] = evaluate(1).values();
      return v === null || v === undefined ? "NULL" : String(v);
    } catch (e) {
      return t("Error: {message}", { message: (e as Error).message });
    }
  });

  async function run() {
    const field = create ? name.trim() : target;
    if (!field) return toast(t("Choose a field name."));
    if (create && fields.some((f) => f.toLowerCase() === field.toLowerCase())) return toast(t("A field named {field} exists already.", { field }));
    busy = true;
    try {
      const values = evaluate();
      if (await ensureEditing(layerId)) {
        writeField(field, values, create ? type : undefined);
        toast(t(create ? "Created {field} for {n} features" : "Updated {field} for {n} features", { field, n: values.size.toLocaleString() }));
        props.onclose();
      }
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Field calculator")}>
    <header>
      <h2>{t("Field calculator")} <small>{layer.name}</small></h2>
      <button class="icon" aria-label={t("Close")} onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="tabs">
      <button class:active={create} onclick={() => (create = true)}>{t("Create a new field")}</button>
      <button class:active={!create} onclick={() => (create = false)}>{t("Update an existing field")}</button>
    </div>
    {#if create}
      <div class="grid2">
        <label class="field">{t("Name")}<input bind:value={name} placeholder={t("e.g. area_km2")} /></label>
        <label class="field">{t("Type")}
          <select bind:value={type}>
            <option value="REAL">{t("Decimal number")}</option>
            <option value="INTEGER">{t("Whole number")}</option>
            <option value="TEXT">{t("Text")}</option>
            <option value="BOOLEAN">{t("Boolean")}</option>
            <option value="DATE">{t("Date")}</option>
            <option value="DATETIME">{t("Date and time")}</option>
          </select>
        </label>
      </div>
    {:else}
      <label class="field">{t("Field")}<select bind:value={target}>{#each fields.filter((f) => f !== "fid") as f}<option>{f}</option>{/each}</select></label>
    {/if}
    <label class="field">{t("Expression")}
      <ExpressionInput {layerId} value={expression} {fields} placeholder={t('e.g. $area / 1e6, upper("name")')} onchange={(v) => (expression = v)} />
    </label>
    {#if preview}<p class="hint">{t("First feature:")} <code>{preview}</code></p>{/if}
    {#if count}<label class="field row-inline"><input type="checkbox" bind:checked={onlySelected} /> {t("Selected features only ({n})", { n: count })}</label>{/if}
    <p class="hint">{t("Evaluated by QGIS and written to the layer's GeoPackage; undo with Ctrl+Z while editing.")}</p>
    <footer>
      <button onclick={props.onclose}>{t("Cancel")}</button>
      <button class="primary" disabled={busy || !expression.trim()} onclick={run}>{busy ? t("Calculating…") : t("OK")}</button>
    </footer>
  </div>
</div>
