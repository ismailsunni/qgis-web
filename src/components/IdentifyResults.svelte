<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import { setAttribute, editSession } from "../lib/editing";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let open = $state(0);

  /** Parses typed text back to the column's kind (numbers stay numbers, empty is NULL). */
  const parse = (text: string, old: unknown) => (text === "" || text === "NULL" ? null : typeof old === "number" && !Number.isNaN(Number(text)) ? Number(text) : text);

  function edit(hit: (typeof ui.hits)[number], key: string, old: unknown, text: string) {
    setAttribute(hit.fid, key, parse(text, old));
    const a = hit.attributes.find(([k]) => k === key);
    if (a) a[1] = parse(text, old);
  }

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
          {#if hit.tip}
            <iframe class="tip-frame" title="Map tip" sandbox="" srcdoc={`<style>body{margin:8px 12px;font:13px system-ui}img{max-width:100%}</style>${hit.tip}`}></iframe>
          {/if}
          <table class="attrs">
            <tbody>
              {#each hit.attributes as [k, v]}
                <tr>
                  <th>{k}</th>
                  {#if ui.editing === hit.layerId && editSession() && k !== editSession()!.info.fid}
                    <td><input value={v === null ? "" : String(v)} placeholder="NULL" onchange={(e) => edit(hit, k, v, e.currentTarget.value)} /></td>
                  {:else}
                    <td>{fmt(v)}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
          <button class="link" onclick={() => { ui.current = hit.layerId; ui.tableLayerId = hit.layerId; }}>Open attribute table</button>
        {/if}
      </div>
    {/each}
  </div>
</section>
