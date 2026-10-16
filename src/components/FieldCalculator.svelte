<script lang="ts">
  import { untrack } from "svelte";
  import type { QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer, free } from "../lib/engine";
  import { ensureEditing, writeField, type FieldType } from "../lib/editing";
  import { ui, toast } from "../lib/state.svelte";
  import ExpressionInput from "./ExpressionInput.svelte";
  import Icon from "./Icon.svelte";

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
      return `Error: ${(e as Error).message}`;
    }
  });

  async function run() {
    const field = create ? name.trim() : target;
    if (!field) return toast("Choose a field name.");
    if (create && fields.some((f) => f.toLowerCase() === field.toLowerCase())) return toast(`A field named ${field} exists already.`);
    busy = true;
    try {
      const values = evaluate();
      if (await ensureEditing(layerId)) {
        writeField(field, values, create ? type : undefined);
        toast(`${create ? "Created" : "Updated"} ${field} for ${values.size.toLocaleString()} features`);
        props.onclose();
      }
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Field calculator">
    <header>
      <h2>Field calculator <small>{layer.name}</small></h2>
      <button class="icon" aria-label="Close" onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="tabs">
      <button class:active={create} onclick={() => (create = true)}>Create a new field</button>
      <button class:active={!create} onclick={() => (create = false)}>Update an existing field</button>
    </div>
    {#if create}
      <div class="grid2">
        <label class="field">Name<input bind:value={name} placeholder="e.g. area_km2" /></label>
        <label class="field">Type
          <select bind:value={type}>
            <option value="REAL">Decimal number</option>
            <option value="INTEGER">Whole number</option>
            <option value="TEXT">Text</option>
            <option value="BOOLEAN">Boolean</option>
            <option value="DATE">Date</option>
            <option value="DATETIME">Date and time</option>
          </select>
        </label>
      </div>
    {:else}
      <label class="field">Field<select bind:value={target}>{#each fields.filter((f) => f !== "fid") as f}<option>{f}</option>{/each}</select></label>
    {/if}
    <label class="field">Expression
      <ExpressionInput {layerId} value={expression} {fields} placeholder={'e.g. $area / 1e6, upper("name")'} onchange={(v) => (expression = v)} />
    </label>
    {#if preview}<p class="hint">First feature: <code>{preview}</code></p>{/if}
    {#if count}<label class="field row-inline"><input type="checkbox" bind:checked={onlySelected} /> Selected features only ({count})</label>{/if}
    <p class="hint">Evaluated by QGIS and written to the layer's GeoPackage; undo with Ctrl+Z while editing.</p>
    <footer>
      <button onclick={props.onclose}>Cancel</button>
      <button class="primary" disabled={busy || !expression.trim()} onclick={run}>{busy ? "Calculating…" : "OK"}</button>
    </footer>
  </div>
</div>
