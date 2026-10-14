<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let open = $state(0);

  const fmt = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? v.toLocaleString() : String(v));
</script>

<section class="identify card" aria-label="Identify results">
  <header>
    <h3>Identify <small>{ui.hits.length} feature{ui.hits.length === 1 ? "" : "s"}</small></h3>
    <button class="icon" aria-label="Close" onclick={onclose}><Icon name="close" size={16} /></button>
  </header>
  <div class="identify-body">
    {#each ui.hits as hit, i (hit.layerId + hit.fid)}
      <div class="hit" class:open={open === i}>
        <button class="hit-title" onclick={() => (open = open === i ? -1 : i)}>
          <span class="chev"><Icon name="chevron" size={14} /></span>
          <strong>{hit.title}</strong><span class="muted">{hit.layerName}</span>
        </button>
        {#if open === i}
          <table class="attrs">
            <tbody>
              {#each hit.attributes as [k, v]}
                <tr><th>{k}</th><td>{fmt(v)}</td></tr>
              {/each}
            </tbody>
          </table>
          <button class="link" onclick={() => { ui.current = hit.layerId; ui.tableLayerId = hit.layerId; }}>Open attribute table</button>
        {/if}
      </div>
    {/each}
  </div>
</section>
