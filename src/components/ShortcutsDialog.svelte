<script lang="ts">
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const SHORTCUTS: [string, string][] = [
    ["Ctrl/⌘ K", "Search actions (command palette)"],
    ["Ctrl/⌘ O", "Open project"],
    ["Ctrl/⌘ S", "Save in this browser"],
    ["Ctrl/⌘ Z", "Undo (feature edits while editing)"],
    ["Ctrl/⌘ Shift Z, Ctrl/⌘ Y", "Redo"],
    ["Alt ←", "Previous map view"],
    ["Alt →", "Next map view"],
    ["?", "This list"],
    ["Esc", "Close dialogs and menus"],
    ["Shift + select", "Add to the selection"],
    ["Ctrl/⌘ + select", "Remove from the selection"],
    ["Right-click on the map", "Copy coordinates, identify, bookmark"],
    ["Double-click", "Finish a line or polygon (measure, profile, digitizing)"],
  ];
  const close = () => (ui.shortcuts = false);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <header>
      <h2>Keyboard shortcuts</h2>
      <button class="icon" aria-label="Close" onclick={close}><Icon name="close" size={18} /></button>
    </header>
    <table class="shortcuts">
      <tbody>
        {#each SHORTCUTS as [keys, what]}<tr><td><kbd>{keys}</kbd></td><td>{what}</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>
