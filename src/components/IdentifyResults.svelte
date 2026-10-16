<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import FeatureForm from "./FeatureForm.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let open = $state(0);

  const fmt = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? v.toLocaleString() : String(v));
</script>

<section class="identify card" aria-label="Identify results">
  <header>
    <h3>Identify <small>{ui.hits.length} result{ui.hits.length === 1 ? "" : "s"}</small></h3>
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
          {#if hit.tip}
            <iframe class="tip-frame" title="Map tip" sandbox="" srcdoc={`<style>body{margin:8px 12px;font:13px system-ui}img{max-width:100%}</style>${hit.tip}`}></iframe>
          {/if}
          {#if hit.raster}
            <table class="pixel"><tbody>{#each hit.attributes as [band, v]}<tr><th>{band}</th><td>{fmt(v)}</td></tr>{/each}</tbody></table>
          {:else}
            <FeatureForm layerId={hit.layerId} fid={hit.fid} attributes={hit.attributes} />
            <button class="link" onclick={() => { ui.current = hit.layerId; ui.tableLayerId = hit.layerId; }}>Open attribute table</button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</section>
