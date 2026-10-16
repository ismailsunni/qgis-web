<script lang="ts">
  import { canLink, pickFiles, pickFolder, projectFileHandle, linked, type PickedFile } from "../lib/localfs";
  import { unavailableLayers, relocateAll, matchInFolder } from "../lib/relocate";
  import { pickedFiles } from "../lib/actions";
  import { ui, toast } from "../lib/state.svelte";
  import { t } from "../lib/i18n";
  import Icon from "./Icon.svelte";

  /** QGIS's "Handle Unavailable Layers": locate the files of layers whose data can't be found. */
  let { onclose }: { onclose: () => void } = $props();

  const layers = $derived((ui.version, unavailableLayers()));
  const startIn = () => linked()?.dir ?? projectFileHandle();

  /** Files from the File System Access pickers, or from a file input where they aren't available. */
  function choose(folder: boolean): Promise<PickedFile[]> {
    if (canLink) return (folder ? pickFolder(startIn()) : pickFiles(startIn())).then((r) => r.files);
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, webkitdirectory: folder });
      input.onchange = () => resolve(pickedFiles(input.files!));
      input.click();
    });
  }

  async function run(pick: () => Promise<[string, PickedFile[]][]>) {
    try {
      const found = await pick();
      const n = await relocateAll(found);
      const left = unavailableLayers().length;
      toast(left ? t("Found {n}; {left} still missing", { n, left }) : n === 1 ? t("Found 1 layer's data") : t("Found the data of {n} layers", { n }));
      if (!left) onclose();
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message);
    }
  }

  // A located file serves every layer expecting it (e.g. the tables of one GeoPackage).
  const browse = (path: string) =>
    run(async () => {
      const files = await choose(false);
      return layers.filter((l) => l.path === path).map((l): [string, PickedFile[]] => [l.id, files]);
    });
  const search = () => run(async () => matchInFolder(await choose(true)));
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card unavailable" role="dialog" aria-modal="true" aria-label={t("Unavailable layers")}>
    <header>
      <h2>{t("Unavailable layers")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <p class="hint">{t("These layers read files the browser can't reach. Locate them: the project keeps its original paths, so it still opens in QGIS Desktop.")}</p>
    <button class="primary" onclick={search}><Icon name="folder" size={16} /> {t("Search a folder…")}</button>
    <table class="fields-table">
      <thead><tr><th>{t("Layer")}</th><th>{t("Expected file")}</th><th></th></tr></thead>
      <tbody>
        {#each layers as l (l.id)}
          <tr>
            <td>{l.name}</td>
            <td class="source" title={l.path}><code>{l.path}</code></td>
            <td><button onclick={() => browse(l.path)}>{t("Browse…")}</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !layers.length}<p class="muted">{t("All layers have their data.")}</p>{/if}
    <p class="hint">{t("Select a Shapefile together with its .dbf, .shx and .prj files.")}</p>
  </div>
</div>
