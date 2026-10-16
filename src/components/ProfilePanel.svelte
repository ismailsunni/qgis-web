<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import { setMarker } from "../lib/maptools";
  import Icon from "./Icon.svelte";

  const p = $derived(ui.profile!);
  const W = 800, H = 160, PAD = 34;
  const zRange = $derived([p.min - (p.max - p.min) * 0.05 - 1e-9, p.max + (p.max - p.min) * 0.05 + 1e-9]);
  const sx = (d: number) => PAD + (d / (p.length || 1)) * (W - PAD - 8);
  const sy = (z: number) => H - 18 - ((z - zRange[0]) / (zRange[1] - zRange[0])) * (H - 30);
  const path = $derived(
    p.points.map((pt, i) => (pt.z === null ? "" : `${i && p.points[i - 1].z !== null ? "L" : "M"}${sx(pt.d).toFixed(1)},${sy(pt.z).toFixed(1)}`)).join(""),
  );
  const area = $derived(path ? `${path}L${sx(p.length)},${H - 18}L${PAD},${H - 18}Z` : "");
  let hover = $state<number | null>(null);
  const fmtD = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
  const fmtZ = (z: number) => `${+z.toFixed(1)}`;

  function move(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const d = (((e.clientX - r.left) / r.width) * W - PAD) / (W - PAD - 8) * p.length;
    let best = 0;
    for (let i = 0; i < p.points.length; i++) if (Math.abs(p.points[i].d - d) < Math.abs(p.points[best].d - d)) best = i;
    hover = best;
    setMarker(p.points[best].xy);
  }
</script>

<section class="drawer profile" aria-label="Elevation profile">
  <header>
    <h3><Icon name="profile" size={16} /> Profile of {p.layer}</h3>
    <span class="muted">length {fmtD(p.length)} · min {fmtZ(p.min)} · max {fmtZ(p.max)} · climb {fmtZ(p.gain)} · descent {fmtZ(p.loss)}</span>
    <button class="icon" aria-label="Close profile" onclick={() => { ui.profile = null; setMarker(null); }}><Icon name="close" size={18} /></button>
  </header>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Elevation along the line" onpointermove={move} onpointerleave={() => { hover = null; setMarker(null); }}>
    <path d={area} class="area" />
    <path d={path} class="line" />
    <text x="2" y={sy(p.max) + 4}>{fmtZ(p.max)}</text>
    <text x="2" y={sy(p.min) + 4}>{fmtZ(p.min)}</text>
    <text x={W - 8} y={H - 4} text-anchor="end">{fmtD(p.length)}</text>
    {#if hover !== null && p.points[hover].z !== null}
      <line x1={sx(p.points[hover].d)} x2={sx(p.points[hover].d)} y1="6" y2={H - 18} class="cursor" />
      <text x={Math.min(W - 120, sx(p.points[hover].d) + 6)} y="16">{fmtD(p.points[hover].d)} · {fmtZ(p.points[hover].z!)}</text>
    {/if}
  </svg>
</section>
