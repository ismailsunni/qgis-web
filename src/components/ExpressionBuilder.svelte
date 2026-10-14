<script lang="ts">
  import { untrack } from "svelte";
  import type { QgsVectorLayer } from "qgis-js";
  import { engine, findMapLayer, free } from "../lib/engine";
  import Icon from "./Icon.svelte";

  interface Fn { name: string; group: string; syntax: string; description: string; example: string; params: number }

  let { layerId, initial = "", onapply, onclose, title = "Expression" }: {
    layerId: string;
    initial?: string;
    onapply: (expr: string) => void;
    onclose: () => void;
    title?: string;
  } = $props();

  // A modal opened per use: the props are read once.
  const layer = untrack(() => findMapLayer(layerId)) as QgsVectorLayer;
  const fields = Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i).name());
  let expr = $state(untrack(() => initial));
  let search = $state("");
  let featureIndex = $state(0);
  let selected = $state<Fn | { name: string; field: true } | null>(null);
  let functions = $state<Fn[]>([]);
  let textarea: HTMLTextAreaElement;
  import("../data/functions.json").then((m) => (functions = m.default as Fn[]));

  const OPERATORS = ["=", "<>", "<", ">", "<=", ">=", "+", "-", "*", "/", "||", "AND", "OR", "NOT", "IS NULL", "LIKE", "ILIKE", "IN ()", "CASE WHEN  THEN  ELSE  END"];

  /** Evaluates with QGIS against one feature of the layer, exactly as Desktop would. */
  const preview = $derived.by(() => {
    if (!expr.trim()) return { ok: true, text: "" };
    const api = engine();
    const e = new api.QgsExpression(expr);
    try {
      if (e.hasParserError()) return { ok: false, text: e.parserErrorString() };
      const req = new api.QgsFeatureRequest();
      req.setLimit(featureIndex + 1);
      const it = layer.getFeatures(req);
      let f = it.nextFeature();
      for (let i = 0; f && i < featureIndex; i++) {
        free(f);
        f = it.nextFeature();
      }
      const ctx = layer.createExpressionContext();
      if (f) ctx.setFeature(f);
      const v = e.evaluate(ctx);
      const err = e.hasEvalError() ? e.evalErrorString() : "";
      free(f);
      free(it);
      free(req);
      free(ctx);
      return err ? { ok: false, text: err } : { ok: true, text: v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v) };
    } finally {
      free(e);
    }
  });

  const q = $derived(search.toLowerCase());
  const groups = $derived.by(() => {
    const out: Record<string, Fn[]> = {};
    for (const f of functions) if (!q || f.name.toLowerCase().includes(q) || f.group.toLowerCase().includes(q)) (out[f.group] ??= []).push(f);
    return Object.entries(out);
  });

  function insert(text: string) {
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    expr = expr.slice(0, start) + text + expr.slice(end);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + (text.endsWith("()") ? text.length - 1 : text.length);
      textarea.setSelectionRange(pos, pos);
    });
  }

  const insertFn = (f: Fn) => insert(f.params === 0 || f.name.startsWith("$") ? f.name : `${f.name}()`);
  const quoteField = (f: string) => `"${f.replaceAll('"', '""')}"`;

  /** A few distinct values of a field, to help write filters. */
  function sampleValues(field: string) {
    const api = engine();
    const req = new api.QgsFeatureRequest();
    req.setLimit(2000);
    const it = layer.getFeatures(req);
    const vals = new Set<string>();
    for (let f = it.nextFeature(); f && vals.size < 25; f = it.nextFeature()) {
      const v = f.attribute(field);
      vals.add(v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
      free(f);
    }
    free(it);
    free(req);
    return [...vals];
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card builder" role="dialog" aria-modal="true" aria-label="Expression builder">
    <header>
      <h2>{title} <small>{layer.name}</small></h2>
      <button class="icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="builder-body">
      <div class="builder-left">
        <textarea bind:this={textarea} bind:value={expr} class="code" spellcheck="false" placeholder={'e.g. "population" > 1000000 AND "continent" = \'Africa\''}></textarea>
        <div class="row ops">{#each OPERATORS as op}<button onclick={() => insert(` ${op} `)}>{op}</button>{/each}</div>
        <div class="preview" class:error={!preview.ok}>
          <span class="muted">Preview</span>
          <button class="icon" aria-label="Previous feature" disabled={featureIndex === 0} onclick={() => featureIndex--}>‹</button>
          <span class="muted">feature {featureIndex + 1}</span>
          <button class="icon" aria-label="Next feature" onclick={() => featureIndex++}>›</button>
          <code>{preview.text}</code>
        </div>
        {#if selected}
          <div class="fn-help">
            {#if "field" in selected}
              <h3>{selected.name}</h3>
              <p class="muted">Field. Double-click a value to insert it.</p>
              <div class="values">{#each sampleValues(selected.name) as v}<button ondblclick={() => insert(v)}>{v}</button>{/each}</div>
            {:else}
              <h3>{selected.name}</h3>
              <code>{selected.syntax}</code>
              <p>{selected.description}</p>
              {#if selected.example}<p class="muted">Example: <code>{selected.example}</code></p>{/if}
            {/if}
          </div>
        {/if}
      </div>
      <div class="builder-right">
        <input placeholder="Search functions and fields" bind:value={search} />
        <ul class="fn-list">
          <li class="group">Fields</li>
          {#each fields.filter((f) => !q || f.toLowerCase().includes(q)) as f}
            <li><button onclick={() => (selected = { name: f, field: true })} ondblclick={() => insert(quoteField(f))}>{f}</button></li>
          {/each}
          {#each groups as [group, fns]}
            <li class="group">{group}</li>
            {#each fns as f}
              <li><button onclick={() => (selected = f)} ondblclick={() => insertFn(f)}>{f.name}</button></li>
            {/each}
          {/each}
        </ul>
        <p class="hint">Double-click to insert.</p>
      </div>
    </div>
    <footer class="row end">
      <button onclick={onclose}>Cancel</button>
      <button class="primary" disabled={!preview.ok} onclick={() => onapply(expr.trim())}>OK</button>
    </footer>
  </div>
</div>
