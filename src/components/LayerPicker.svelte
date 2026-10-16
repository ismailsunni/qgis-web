<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { t, N_ } from "../lib/i18n";

  const p = ui.layerPicker!;
  let chosen = $state(p.items.map(([name]) => name));
  const KIND: Record<string, string> = { features: N_("vector"), tiles: N_("raster"), attributes: N_("table") };

  function done(names: string[]) {
    ui.layerPicker = null;
    p.resolve(names);
  }
</script>

<div class="overlay modal" role="presentation">
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Select layers to add")}>
    <header>
      <h2>{t("Layers in {file}", { file: p.file })}</h2>
      <button class="icon" aria-label={t("Cancel")} onclick={() => done([])}><Icon name="close" size={18} /></button>
    </header>
    <div class="row">
      <button class="link" onclick={() => (chosen = p.items.map(([n]) => n))}>{t("Select all")}</button>
      <button class="link" onclick={() => (chosen = [])}>{t("Select none")}</button>
    </div>
    <div class="picker-list">
      {#each p.items as [name, type]}
        <label class="radio"><input type="checkbox" value={name} bind:group={chosen} /> {name} <span class="muted">{KIND[type] ? t(KIND[type]) : type}</span></label>
      {/each}
    </div>
    <footer>
      <button onclick={() => done([])}>{t("Cancel")}</button>
      <button class="primary" disabled={!chosen.length} onclick={() => done(chosen)}>{chosen.length === 1 ? t("Add {n} layer", { n: chosen.length }) : t("Add {n} layers", { n: chosen.length })}</button>
    </footer>
  </div>
</div>
