<script lang="ts">
  import { addRemote, PRESETS, tileUrl } from "../lib/remote";
</script>

<ul class="basemaps">
  {#each PRESETS as p}
    <li>
      <button onclick={() => addRemote(p, "bottom")} title="Add {p.name} under the other layers">
        <img src={tileUrl(p.url)} alt="" crossorigin="anonymous" loading="lazy" />
        <span>{p.name}</span>
      </button>
    </li>
  {/each}
</ul>
