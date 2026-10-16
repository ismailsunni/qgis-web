<script lang="ts">
  import { onDestroy } from "svelte";
  import { addStep, applyTime, defaultStep, floorTo, timeExtent, UNITS, type Unit } from "../lib/temporal";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const extent = timeExtent();
  let [step, unit] = $state(extent ? defaultStep(extent) : ([1, "days"] as [number, Unit]));
  let frame = $state(0);
  let playing = $state(false);
  let timer = 0;

  const first = $derived(extent ? floorTo(extent[0], unit) : 0);
  const frames = $derived.by(() => {
    if (!extent) return 0;
    let n = 0;
    for (let t = first; t <= extent[1] && n < 5000; t = addStep(t, step, unit)) n++;
    return n;
  });
  const range = $derived<[number, number] | null>(extent ? [addStep(first, frame * step, unit), addStep(first, (frame + 1) * step, unit)] : null);

  $effect(() => {
    ui.time.range = range;
    applyTime(range);
  });

  function play() {
    playing = !playing;
    clearInterval(timer);
    if (playing) timer = window.setInterval(() => (frame = (frame + 1) % frames), 1000);
  }

  onDestroy(() => {
    clearInterval(timer);
    ui.time.range = null;
    if (ui.phase === "ready") applyTime(null);
  });

  const fmt = (ms: number) => {
    const d = new Date(ms).toISOString();
    return unit === "hours" ? d.slice(0, 16).replace("T", " ") : unit === "years" ? d.slice(0, 4) : unit === "months" ? d.slice(0, 7) : d.slice(0, 10);
  };
</script>

<div class="time-slider card" role="group" aria-label="Time slider">
  {#if !extent}
    <span class="muted">No dates found in the temporal layers.</span>
  {:else}
    <button class="icon" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"} onclick={play}>{playing ? "⏸" : "▶"}</button>
    <button class="icon" title="Previous step" aria-label="Previous step" disabled={frame <= 0} onclick={() => frame--}><Icon name="back" size={16} /></button>
    <input type="range" min="0" max={frames - 1} bind:value={frame} aria-label="Time" />
    <button class="icon" title="Next step" aria-label="Next step" disabled={frame >= frames - 1} onclick={() => frame++}><Icon name="forward" size={16} /></button>
    <span class="time-label">{range && `${fmt(range[0])} – ${fmt(range[1])}`}</span>
    <input class="step" type="number" min="1" bind:value={step} aria-label="Step" onchange={() => (frame = 0)} />
    <select bind:value={unit} aria-label="Step unit" onchange={() => (frame = 0)}>{#each Object.keys(UNITS) as u}<option>{u}</option>{/each}</select>
  {/if}
  <button class="icon" title="Close (show all features)" aria-label="Close time slider" onclick={() => (ui.time.active = false)}><Icon name="close" size={16} /></button>
</div>
