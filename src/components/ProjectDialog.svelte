<script lang="ts">
  import { project, child } from "../lib/doc";
  import { engine } from "../lib/engine";
  import { apply } from "../lib/commit";
  import { searchCrs, spatialRefSys, type CrsDef } from "../lib/crs";
  import { showProject } from "../lib/map";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let title = $state(ui.projectName);
  let query = $state("");
  let results = $state<CrsDef[]>([]);
  let picked = $state<CrsDef | null>(null);
  const current = engine().srid();
  const currentName = engine().projectVariables()["project_crs_description"];

  $effect(() => {
    const q = query;
    if (q.length < 2) return void (results = []);
    searchCrs(q).then((r) => q === query && (results = r));
  });

  function save() {
    const xml = project().xml;
    apply(() => {
      child(xml.documentElement, "title").textContent = title;
      if (picked) {
        const crs = new DOMParser().parseFromString(spatialRefSys(picked), "application/xml").documentElement;
        child(xml.documentElement, "projectCrs").replaceChildren(xml.importNode(crs, true));
      }
    });
    ui.projectName = title;
    if (picked) showProject();
    onclose();
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Project properties">
    <header>
      <h2>Project properties</h2>
      <button class="icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <label class="field">Title<input bind:value={title} /></label>
    <div class="field">
      <span>Coordinate reference system</span>
      <p>{picked ? `${picked.authid} – ${picked.description}` : `${current} – ${currentName}`}</p>
      <input placeholder="Search by name or code, e.g. 2056 or Lambert" bind:value={query} />
      {#if results.length}
        <ul class="crs-list">
          {#each results as r (r.authid)}
            <li><button class:active={picked?.authid === r.authid} onclick={() => (picked = r)}><code>{r.authid}</code> {r.description}</button></li>
          {/each}
        </ul>
      {/if}
      <p class="hint">Layers are reprojected on the fly by QGIS; web tiles are reprojected by the browser.</p>
    </div>
    <footer>
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={save}>Apply</button>
    </footer>
  </div>
</div>
