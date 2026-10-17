<script lang="ts">
  import { t } from "../lib/i18n";
  import { exportImage } from "../lib/maptools";
  import { exportPdf, PAGES } from "../lib/printmap";
  import { olMap } from "../lib/map";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let scale = $state(2);
  let legend = $state(true);
  let title = $state(ui.projectName);
  let busy = $state(false);
  let format = $state<"png" | "pdf">("png");
  let page = $state<keyof typeof PAGES>("A4");
  let landscape = $state(true);
  let dpi = $state(150);
  let scaleBar = $state(true);
  let north = $state(true);

  function save(blob: Blob, ext: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ui.projectName || "map"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function pdf() {
    busy = true;
    try {
      save(await exportPdf({ page, landscape, dpi, title: title.trim(), legend, scaleBar, north }), "pdf");
      onclose();
    } catch (e) {
      toast(t("Export failed: {error}", { error: (e as Error).message }));
    }
    busy = false;
  }
  const [w, h] = olMap().getSize() ?? [0, 0];

  async function run(copy: boolean) {
    busy = true;
    try {
      const blob = await exportImage({ scale, legend, title: title.trim() });
      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast(t("Map image copied"));
      } else save(blob, "png");
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
      <h2>{t("Export map")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={format === "png"} class:active={format === "png"} onclick={() => (format = "png")}>{t("Image (PNG)")}</button>
      <button role="tab" aria-selected={format === "pdf"} class:active={format === "pdf"} onclick={() => (format = "pdf")}>{t("Map page (PDF)")}</button>
    </div>
    <label class="field">{t("Title")}<input bind:value={title} placeholder={t("No title")} /></label>
    {#if format === "png"}
      <label class="field">{t("Resolution")}
        <select bind:value={scale}>
          {#each [1, 2, 3, 4] as s}<option value={s}>{96 * s} dpi · {w * s} × {h * s} px</option>{/each}
        </select>
      </label>
      <label class="field row-inline"><input type="checkbox" bind:checked={legend} /> {t("Include the legend")}</label>
      <p class="hint">{t("The current view, rendered by QGIS at the chosen resolution (symbols and labels scale with it).")}</p>
    {:else}
      <div class="grid2">
        <label class="field">{t("Page")}<select bind:value={page}>{#each Object.keys(PAGES) as p}<option>{p}</option>{/each}</select></label>
        <label class="field">{t("Orientation")}<select bind:value={landscape}><option value={true}>{t("Landscape")}</option><option value={false}>{t("Portrait")}</option></select></label>
        <label class="field">{t("Quality")}<select bind:value={dpi}><option value={150}>150 dpi</option><option value={300}>{t("300 dpi (print)")}</option></select></label>
      </div>
      <div class="row">
        <label class="row-inline"><input type="checkbox" bind:checked={legend} /> {t("Legend")}</label>
        <label class="row-inline"><input type="checkbox" bind:checked={scaleBar} /> {t("Scale bar")}</label>
        <label class="row-inline"><input type="checkbox" bind:checked={north} /> {t("North arrow")}</label>
      </div>
      <p class="hint">{t("A page with the current view, fitted to the page and rendered by QGIS, plus the date and credits. For full QGIS print layouts, use QGIS Desktop.")}</p>
    {/if}
    <footer>
      {#if format === "png"}
        <button disabled={busy} onclick={() => run(true)}>{t("Copy")}</button>
        <button class="primary" disabled={busy} onclick={() => run(false)}>{busy ? t("Rendering…") : t("Download PNG")}</button>
      {:else}
        <button class="primary" disabled={busy} onclick={pdf}>{busy ? t("Rendering…") : t("Download PDF")}</button>
      {/if}
    </footer>
  </div>
</div>
