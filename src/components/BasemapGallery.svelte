<script lang="ts">
  import { addRemote, PRESETS, tileUrl } from "../lib/remote";
  import { t } from "../lib/i18n";
</script>

<ul class="basemaps">
  {#each PRESETS as p}
    <li>
      <button onclick={() => addRemote(p, "bottom")} title={t("Add {name} under the other layers", { name: p.name })}>
        <img src={tileUrl(p.url)} alt="" crossorigin="anonymous" loading="lazy" />
        <span>{p.name}</span>
      </button>
    </li>
  {/each}
</ul>
