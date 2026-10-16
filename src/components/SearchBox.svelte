<script lang="ts">
  import { t } from "../lib/i18n";
  import { parseCoordinate, searchPlaces, goToPlace, goToXY, type Place } from "../lib/maptools";
  import { toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let q = $state("");
  let results = $state<Place[]>([]);
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    const c = parseCoordinate(text);
    if (c?.lonlat) return goToPlace({ label: text, lon: c.lonlat[0], lat: c.lonlat[1], bbox: [c.lonlat[0] - 0.005, c.lonlat[1] - 0.005, c.lonlat[0] + 0.005, c.lonlat[1] + 0.005] });
    if (c?.xy) return goToXY(c.xy);
    busy = true;
    try {
      results = await searchPlaces(text);
      if (!results.length) toast(t("No place found"));
    } catch (err) {
      toast((err as Error).message);
    }
    busy = false;
  }
</script>

<form class="map-search card" onsubmit={submit} role="search">
  <Icon name="search" size={16} />
  <input bind:value={q} placeholder={t("Search places or coordinates (lat, lon)")} aria-label={t("Search places or coordinates")} oninput={() => (results = [])} onkeydown={(e) => e.key === "Escape" && ((q = ""), (results = []))} />
  {#if busy}<span class="spinner small" aria-hidden="true"></span>{/if}
  {#if results.length}
    <ul class="search-results">
      {#each results as r}
        <li><button type="button" onclick={() => { goToPlace(r); results = []; }}>{r.label}</button></li>
      {/each}
      <li class="hint">{t("Search by OpenStreetMap Nominatim")}</li>
    </ul>
  {/if}
</form>
