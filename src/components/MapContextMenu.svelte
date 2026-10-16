<script lang="ts">
  import { t } from "../lib/i18n";
  import { olMap } from "../lib/map";
  import { identifyAt } from "../lib/actions";
  import { projectToLonLat } from "../lib/maptools";
  import { formatCoord, FORMATS, FORMAT_LABELS } from "../lib/coords";
  import { addBookmark } from "../lib/bookmarks";
  import { toast } from "../lib/state.svelte";

  let { at, onclose }: { at: { pixel: number[]; coordinate: number[] }; onclose: () => void } = $props();

  const lonlat = $derived(projectToLonLat(at.coordinate));
  const coords = $derived(FORMATS.filter((f) => f === "project" || lonlat).map((f) => [t(FORMAT_LABELS[f]), formatCoord(f, at.coordinate, lonlat)]));

  function run(fn: () => unknown) {
    fn();
    onclose();
  }
  const copy = (text: string) => run(() => navigator.clipboard.writeText(text).then(() => toast(t("Copied {text}", { text }))));
  const view = () => olMap().getView();
</script>

<svelte:window onpointerdown={(e) => !(e.target as Element).closest(".context-menu") && onclose()} onkeydown={(e) => e.key === "Escape" && onclose()} />

<div class="context-menu card" role="menu" style:left="{at.pixel[0]}px" style:top="{at.pixel[1]}px">
  {#each coords as [label, text]}
    <button role="menuitem" title={t("Copy {label}", { label })} onclick={() => copy(text)}><span class="muted">{label}</span> {text}</button>
  {/each}
  <hr />
  <button role="menuitem" onclick={() => run(() => identifyAt(at.coordinate))}>{t("Identify here")}</button>
  <button role="menuitem" onclick={() => run(() => view().animate({ center: at.coordinate, duration: 250 }))}>{t("Center map here")}</button>
  <button role="menuitem" onclick={() => run(() => view().animate({ center: at.coordinate, zoom: view().getZoom()! + 1, duration: 250 }))}>{t("Zoom in here")}</button>
  <button role="menuitem" onclick={() => run(() => (view().setCenter(at.coordinate), addBookmark(t("Bookmark at {coord}", { coord: coords[0][1] }))))}>{t("Add bookmark here")}</button>
</div>
