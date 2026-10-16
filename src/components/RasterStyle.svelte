<script lang="ts">
  import { apply } from "../lib/commit";
  import { rasterInfo, readRasterStyle, setRasterStyle, type RasterInfo, type RasterStyle, type RasterType } from "../lib/raster";
  import { RAMPS } from "../lib/style";
  import { ui } from "../lib/state.svelte";

  let { layerId }: { layerId: string } = $props();
  let info = $state<RasterInfo | null>(null);
  $effect(() => {
    rasterInfo(layerId).then((i) => (info = i));
  });
  const style = $derived((ui.version, readRasterStyle(layerId)));
  const TYPES: [RasterType, string][] = [["singlebandpseudocolor", "Pseudocolor (one band)"], ["singlebandgray", "Grayscale (one band)"], ["hillshade", "Hillshade"], ["multibandcolor", "RGB (three bands)"]];
  const bands = $derived(Array.from({ length: info?.bands ?? 1 }, (_, i) => i + 1));

  function set(type: RasterType, p: Partial<RasterStyle> = {}) {
    let s = { ...style, ...p };
    // Switching renderer or band: start from the band's actual value range.
    if (info && (type !== style.type || p.band) && !("min" in p)) s = { ...s, ...info.stats[s.band - 1] };
    if (type === "multibandcolor" && style.type !== type && info) s = { ...s, red: 1, green: Math.min(2, info.bands), blue: Math.min(3, info.bands) };
    apply(() => setRasterStyle(layerId, type, s, info), "raster style");
  }

  const type = $derived((TYPES.find(([t]) => t === style.type)?.[0] ?? "") as RasterType | "");
</script>

<section class="stack">
  <h3>Raster style</h3>
  <label class="field">Render type
    <select value={type} onchange={(e) => set(e.currentTarget.value as RasterType)}>
      {#if !type}<option value="">{style.type || "Default"}</option>{/if}
      {#each TYPES as [t, label]}<option value={t} disabled={t === "multibandcolor" && (info?.bands ?? 3) < 3}>{label}</option>{/each}
    </select>
  </label>
  {#if type && type !== "multibandcolor"}
    <div class="grid2">
      <label class="field">Band<select value={style.band} onchange={(e) => set(type, { band: +e.currentTarget.value })}>{#each bands as b}<option value={b}>Band {b}</option>{/each}</select></label>
      {#if type === "singlebandpseudocolor"}
        <label class="field">Colors<select value={style.ramp} onchange={(e) => set(type, { ramp: e.currentTarget.value })}>{#each Object.keys(RAMPS).filter((n) => !RAMPS[n].qualitative) as name}<option>{name}</option>{/each}</select></label>
      {/if}
      {#if type !== "hillshade"}
        <label class="field">Min<input type="number" step="any" value={style.min} onchange={(e) => set(type, { min: e.currentTarget.valueAsNumber })} /></label>
        <label class="field">Max<input type="number" step="any" value={style.max} onchange={(e) => set(type, { max: e.currentTarget.valueAsNumber })} /></label>
      {:else}
        <label class="field">Azimuth (°)<input type="number" min="0" max="360" value={style.azimuth} onchange={(e) => set(type, { azimuth: e.currentTarget.valueAsNumber })} /></label>
        <label class="field">Altitude (°)<input type="number" min="0" max="90" value={style.altitude} onchange={(e) => set(type, { altitude: e.currentTarget.valueAsNumber })} /></label>
        <label class="field">Z factor<input type="number" step="any" value={style.zFactor} onchange={(e) => set(type, { zFactor: e.currentTarget.valueAsNumber })} /></label>
        <label class="field row-inline"><input type="checkbox" checked={style.multidirectional} onchange={(e) => set(type, { multidirectional: e.currentTarget.checked })} /> Multidirectional</label>
      {/if}
    </div>
    {#if info?.stats[style.band - 1]?.histogram}
      {@const b = info.stats[style.band - 1]}
      {@const peak = Math.max(...b.histogram!)}
      {@const at = (v: number) => ((v - b.min) / (b.max - b.min || 1)) * 64}
      <svg class="histogram" viewBox="0 0 64 30" preserveAspectRatio="none" role="img" aria-label="Histogram of band {style.band}">
        {#each b.histogram! as n, i}<rect x={i} width="1" y={30 - (n / peak) * 30} height={(n / peak) * 30} />{/each}
        {#if type !== "hillshade"}<line class="range" x1={at(style.min)} x2={at(style.min)} y1="0" y2="30" /><line class="range" x1={at(style.max)} x2={at(style.max)} y1="0" y2="30" />{/if}
      </svg>
      <p class="hint histogram-axis"><span>{+b.min.toPrecision(5)}</span><span>Histogram of band {style.band}</span><span>{+b.max.toPrecision(5)}</span></p>
    {/if}
    {#if info && type !== "hillshade"}<button class="link" onclick={() => set(type, { ...info!.stats[style.band - 1] })}>Reset to the band's range ({+info.stats[style.band - 1].min.toPrecision(5)} – {+info.stats[style.band - 1].max.toPrecision(5)})</button>{/if}
  {:else if type === "multibandcolor"}
    <div class="grid2">
      {#each [["red", "Red"], ["green", "Green"], ["blue", "Blue"]] as [k, label]}
        <label class="field">{label}<select value={style[k as "red"]} onchange={(e) => set(type, { [k]: +e.currentTarget.value })}>{#each bands as b}<option value={b}>Band {b}</option>{/each}</select></label>
      {/each}
    </div>
  {/if}
  {#if !info}<p class="hint">Band statistics are read from local GeoTIFFs; for other rasters set min and max yourself.</p>{/if}
</section>
