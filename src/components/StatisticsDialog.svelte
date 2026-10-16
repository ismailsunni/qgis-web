<script lang="ts">
  import { untrack } from "svelte";
  import { fieldStats } from "../lib/stats";
  import { toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let props: { title: string; fields: string[]; column: (field: string) => unknown[]; scope: string; onclose: () => void } = $props();
  let field = $state(untrack(() => props.fields.find((f) => f !== "fid") ?? props.fields[0]));
  const stats = $derived(fieldStats(props.column(field)));
  const fmt = (v: number) => (Math.abs(v) >= 1e6 || Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 }));

  const rows = $derived<[string, string][]>(
    stats.kind === "numeric"
      ? [["Count", fmt(stats.count)], ["Missing (NULL)", fmt(stats.nulls)], ["Sum", fmt(stats.sum)], ["Mean", fmt(stats.mean)], ["Median", fmt(stats.median)], ["Standard deviation", fmt(stats.stddev)], ["Minimum", fmt(stats.min)], ["Maximum", fmt(stats.max)], ["Range", fmt(stats.max - stats.min)], ["Distinct values", fmt(stats.unique)]]
      : [["Count", fmt(stats.count)], ["Missing (NULL or empty)", fmt(stats.nulls)], ["Distinct values", fmt(stats.unique)], ["Shortest", `${stats.minLength} characters`], ["Longest", `${stats.maxLength} characters`]],
  );
  const peak = $derived(stats.kind === "numeric" ? Math.max(1, ...stats.histogram.map((b) => b.n)) : Math.max(1, ...stats.top.map((t) => t[1])));

  async function copy() {
    await navigator.clipboard.writeText(["statistic,value", ...rows.map(([k, v]) => `${k},"${v}"`)].join("\n"));
    toast("Statistics copied");
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog card stats" role="dialog" aria-modal="true" aria-label="Statistics">
    <header>
      <h2>Statistics <small>{props.title} · {props.scope}</small></h2>
      <button class="icon" aria-label="Close" onclick={props.onclose}><Icon name="close" size={18} /></button>
    </header>
    <label class="field">Field<select bind:value={field}>{#each props.fields as f}<option>{f}</option>{/each}</select></label>
    <div class="stats-body">
      <table class="attrs"><tbody>{#each rows as [k, v]}<tr><th>{k}</th><td>{v}</td></tr>{/each}</tbody></table>
      {#if stats.kind === "numeric" && stats.count}
        <figure class="chart" aria-label="Histogram">
          <svg viewBox="0 0 {stats.histogram.length * 12} 100" preserveAspectRatio="none">
            {#each stats.histogram as b, i}
              <rect x={i * 12 + 1} y={100 - (b.n / peak) * 96} width="10" height={(b.n / peak) * 96}><title>{fmt(b.from)} – {fmt(b.to)}: {b.n}</title></rect>
            {/each}
          </svg>
          <figcaption><span>{fmt(stats.min)}</span><span>Histogram</span><span>{fmt(stats.max)}</span></figcaption>
        </figure>
      {:else if stats.kind === "text"}
        <ul class="bars" aria-label="Most frequent values">
          {#each stats.top as [v, n]}
            <li><span class="bar-label" title={v}>{v}</span><span class="bar" style:width="{(n / peak) * 100}%"></span><span class="muted">{n}</span></li>
          {/each}
        </ul>
      {/if}
    </div>
    <footer><button onclick={copy}>Copy</button></footer>
  </div>
</div>
