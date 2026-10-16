<script lang="ts">
  import { t } from "../lib/i18n";
  import { exportImage } from "../lib/maptools";
  import { olMap } from "../lib/map";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let scale = $state(2);
  let legend = $state(true);
  let title = $state(ui.projectName);
  let busy = $state(false);
  const [w, h] = olMap().getSize() ?? [0, 0];

  async function run(copy: boolean) {
    busy = true;
    try {
      const blob = await exportImage({ scale, legend, title: title.trim() });
      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast(t("Map image copied"));
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${ui.projectName || "map"}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      onclose();
    } catch (e) {
      toast(t("Export failed: {error}", { error: (e as Error).message }));
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Export map image")}>
    <header>
      <h2>{t("Export map image")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="grid2">
      <label class="field">{t("Resolution")}
        <select bind:value={scale}>
          {#each [1, 2, 3, 4] as s}<option value={s}>{96 * s} dpi · {w * s} × {h * s} px</option>{/each}
        </select>
      </label>
      <label class="field">{t("Title")}<input bind:value={title} placeholder={t("No title")} /></label>
    </div>
    <label class="field row-inline"><input type="checkbox" bind:checked={legend} /> {t("Include the legend")}</label>
    <p class="hint">{t("The current view, rendered by QGIS at the chosen resolution (symbols and labels scale with it).")}</p>
    <footer>
      <button disabled={busy} onclick={() => run(true)}>{t("Copy")}</button>
      <button class="primary" disabled={busy} onclick={() => run(false)}>{busy ? t("Rendering…") : t("Download PNG")}</button>
    </footer>
  </div>
</div>
