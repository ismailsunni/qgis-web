<script lang="ts">
  import { commands } from "../lib/actions";
  import { ui } from "../lib/state.svelte";

  let query = $state("");
  let active = $state(0);
  const all = commands();
  const results = $derived(
    all.filter((c) => query.toLowerCase().split(/\s+/).every((w) => c.label.toLowerCase().includes(w))).slice(0, 50),
  );

  function run(i: number) {
    const cmd = results[i];
    if (!cmd) return;
    ui.palette = false;
    cmd.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") active = Math.min(active + 1, results.length - 1);
    else if (e.key === "ArrowUp") active = Math.max(active - 1, 0);
    else if (e.key === "Enter") run(active);
    else if (e.key === "Escape") ui.palette = false;
    else return;
    e.preventDefault();
  }
</script>

<div class="overlay modal top" role="presentation" onclick={(e) => e.target === e.currentTarget && (ui.palette = false)}>
  <div class="palette card" role="dialog" aria-modal="true" aria-label="Command palette">
    <!-- svelte-ignore a11y_autofocus -->
    <input placeholder="Type an action or layer name…" bind:value={query} oninput={() => (active = 0)} onkeydown={onKey} autofocus />
    <ul role="listbox">
      {#each results as cmd, i (cmd.id)}
        <li role="option" aria-selected={i === active}>
          <button class:active={i === active} onmouseenter={() => (active = i)} onclick={() => run(i)}>
            {cmd.label}{#if cmd.hint}<kbd>{cmd.hint}</kbd>{/if}
          </button>
        </li>
      {:else}
        <li class="muted empty">No matching action</li>
      {/each}
    </ul>
  </div>
</div>
