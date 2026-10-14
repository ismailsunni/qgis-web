<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const link = (extra = "") => `${location.origin}${location.pathname}?url=${encodeURIComponent(ui.sourceUrl!)}${extra}`;
  const embed = () => `<iframe src="${link("&maponly")}" width="800" height="500" style="border:0" allow="cross-origin-isolated"></iframe>`;
  let copied = $state("");

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    copied = what;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Share">
    <header>
      <h2>Share</h2>
      <button class="icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    {#if !ui.sourceUrl}
      <p>This project was opened from local files, so there is nothing to link to: your data stays on this machine.</p>
      <p class="hint">Host the project and its data on any static server with CORS, then open it with “From a URL” to get a share link.</p>
    {:else}
      {#each [["Full app", link()], ["Compact", link("&layout=compact")], ["Map only", link("&maponly")], ["Embed (iframe)", embed()]] as [label, text]}
        <label class="share-row">
          <span>{label}</span>
          <div class="row">
            <input readonly value={text} onfocus={(e) => e.currentTarget.select()} />
            <button onclick={() => copy(text, label)}>{copied === label ? "Copied" : "Copy"}</button>
          </div>
        </label>
      {/each}
    {/if}
  </div>
</div>
