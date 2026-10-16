<script lang="ts">
  import { t, N_ } from "../lib/i18n";
  import { ui } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  const SHORTCUTS: [string, string][] = [
    ["Ctrl/⌘ K", N_("Search actions (command palette)")],
    ["Ctrl/⌘ O", N_("Open project")],
    ["Ctrl/⌘ S", N_("Save in this browser")],
    ["Ctrl/⌘ Z", N_("Undo (feature edits while editing)")],
    ["Ctrl/⌘ Shift Z, Ctrl/⌘ Y", N_("Redo")],
    ["Ctrl/⌘ C", N_("Copy the selected features")],
    ["Ctrl/⌘ V", N_("Paste features into the layer being edited")],
    ["Alt ←", N_("Previous map view")],
    ["Alt →", N_("Next map view")],
    ["?", N_("This list")],
    ["Esc", N_("Close dialogs and menus")],
    [N_("Shift + select"), N_("Add to the selection")],
    [N_("Ctrl/⌘ + select"), N_("Remove from the selection")],
    [N_("Right-click on the map"), N_("Copy coordinates, identify, bookmark")],
    [N_("Right-click on a layer"), N_("Layer menu, including Properties")],
    [N_("Double-click"), N_("Finish a line or polygon (measure, profile, digitizing)")],
  ];
  const close = () => (ui.shortcuts = false);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Keyboard shortcuts")}>
    <header>
      <h2>{t("Keyboard shortcuts")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={close}><Icon name="close" size={18} /></button>
    </header>
    <table class="shortcuts">
      <tbody>
        {#each SHORTCUTS as [keys, what]}<tr><td><kbd>{t(keys)}</kbd></td><td>{t(what)}</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>
