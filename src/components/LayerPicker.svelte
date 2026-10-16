<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const p = ui.layerPicker!;
  let chosen = $state(p.items.map(([name]) => name));
  const KIND: Record<string, string> = { features: "vector", tiles: "raster", attributes: "table" };

  function done(names: string[]) {
    ui.layerPicker = null;
    p.resolve(names);
  }
</script>

<div class="overlay modal" role="presentation">
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Select layers to add">
    <header>
      <h2>Layers in {p.file}</h2>
      <button class="icon" aria-label="Cancel" onclick={() => done([])}><Icon name="close" size={18} /></button>
    </header>
    <div class="row">
      <button class="link" onclick={() => (chosen = p.items.map(([n]) => n))}>Select all</button>
      <button class="link" onclick={() => (chosen = [])}>Select none</button>
    </div>
    <div class="picker-list">
      {#each p.items as [name, type]}
        <label class="radio"><input type="checkbox" value={name} bind:group={chosen} /> {name} <span class="muted">{KIND[type] ?? type}</span></label>
      {/each}
    </div>
    <footer>
      <button onclick={() => done([])}>Cancel</button>
      <button class="primary" disabled={!chosen.length} onclick={() => done(chosen)}>Add {chosen.length} layer{chosen.length === 1 ? "" : "s"}</button>
    </footer>
  </div>
</div>
