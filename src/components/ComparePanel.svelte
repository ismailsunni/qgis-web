<script lang="ts">
  import { t } from "../lib/i18n";

  import { flatLayers, snapshotTree } from "../lib/tree";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const layers = $derived((ui.version, flatLayers(snapshotTree()).filter((l) => l.valid || l.remote)));

  function toggle(id: string, on: boolean) {
    ui.compare.layers = on ? [...ui.compare.layers, id] : ui.compare.layers.filter((l) => l !== id);
  }

</script>

<div class="compare-panel card">
  <header>
    <b>{t("Compare")}</b>
    <div class="tabs">
      <button class:active={ui.compare.mode === "swipe"} onclick={() => (ui.compare.mode = "swipe")}>{t("Swipe")}</button>
      <button class:active={ui.compare.mode === "side"} onclick={() => (ui.compare.mode = "side")}>{t("Side by side")}</button>
    </div>
    <button class="icon" aria-label={t("Close compare")} onclick={() => (ui.compare.active = false)}><Icon name="close" size={16} /></button>
  </header>
  <p class="hint">{ui.compare.mode === "swipe" ? t("Right of the divider shows:") : t("Right map shows:")}</p>
  <ul>
    {#each layers as l (l.layerId)}
      <li><label><input type="checkbox" checked={ui.compare.layers.includes(l.layerId!)} onchange={(e) => toggle(l.layerId!, e.currentTarget.checked)} /> {l.name}</label></li>
    {/each}
  </ul>
</div>
