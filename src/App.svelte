<script lang="ts">
  import { onMount } from "svelte";
  import { undo, redo } from "./lib/editing";
  import { undoProject, redoProject } from "./lib/history";
  import { addData } from "./lib/adddata";
  import { scheduleAutosave } from "./lib/autosave";
  import { boot } from "./lib/engine";
  import { ui, view, type Panel } from "./lib/state.svelte";
  import { droppedFiles, openFiles, openUrl, openPublished, runStartup, pickedFiles, saveInBrowser, downloadProject, downloadBundle } from "./lib/actions";
  import Icon from "./components/Icon.svelte";
  import MapView from "./components/MapView.svelte";
  import LayersPanel from "./components/LayersPanel.svelte";
  import AddDataPanel from "./components/AddDataPanel.svelte";
  import StylePanel from "./components/StylePanel.svelte";
  import ToolsPanel from "./components/ToolsPanel.svelte";
  import HubPanel from "./components/HubPanel.svelte";
  import BookmarksPanel from "./components/BookmarksPanel.svelte";
  import AttributeTable from "./components/AttributeTable.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import Welcome from "./components/Welcome.svelte";
  import ShareDialog from "./components/ShareDialog.svelte";
  import ProjectDialog from "./components/ProjectDialog.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import SelectByLocation from "./components/SelectByLocation.svelte";
  import ExportLayerDialog from "./components/ExportLayerDialog.svelte";
  import ExpressionBuilder from "./components/ExpressionBuilder.svelte";
  import FieldCalculator from "./components/FieldCalculator.svelte";
  import CsvDialog from "./components/CsvDialog.svelte";
  import ProfilePanel from "./components/ProfilePanel.svelte";
  import LayerPicker from "./components/LayerPicker.svelte";
  import ShortcutsDialog from "./components/ShortcutsDialog.svelte";
  import { previousView, nextView } from "./lib/navigation";
  import { copyFeatures, pasteFeatures } from "./lib/clipboard";
  import { selectByExpression } from "./lib/selection";
  import { t, N_ } from "./lib/i18n";

  const rail: { id: Panel | "table"; icon: "layers" | "add" | "style" | "table" | "tools" | "hub" | "bookmark"; label: string; planned?: string }[] = [
    { id: "layers", icon: "layers", label: N_("Layers") },
    { id: "add", icon: "add", label: N_("Add data") },
    { id: "style", icon: "style", label: N_("Style") },
    { id: "table", icon: "table", label: N_("Attribute table") },
    { id: "tools", icon: "tools", label: N_("Processing tools") },
    { id: "bookmarks", icon: "bookmark", label: N_("Bookmarks") },
    { id: "hub", icon: "hub", label: N_("QGIS Hub") },
  ];
  const titles: Record<Panel, string> = { layers: N_("Layers"), add: N_("Add data"), style: N_("Style"), tools: N_("Processing"), hub: N_("QGIS Hub"), bookmarks: N_("Bookmarks") };

  let dragging = $state(false);
  let menuOpen = $state(false);
  let saveMenu = $state(false);

  // Autosave a few seconds after each change (project or data).
  $effect(() => {
    ui.version;
    ui.dataVersion;
    if (ui.dirty) scheduleAutosave();
  });

  function railClick(id: Panel | "table") {
    if (id === "table") ui.tableLayerId = ui.tableLayerId ? null : ui.current;
    else ui.panel = ui.panel === id ? null : id;
  }

  onMount(async () => {
    // Embedded in a page that isn't cross-origin isolated, multithreaded WebAssembly can't run.
    if (!crossOriginIsolated && window.top !== window) {
      ui.phase = "error";
      ui.error = t("This page can't run the QGIS engine inside an embedded frame. Open the map in its own tab.");
      return;
    }
    try {
      await boot((s) => s && (ui.status = s));
      ui.phase = "empty";
      if (view.gist) await openPublished(view.gist, view.rev);
      else if (view.url) await openUrl(view.url);
      else await runStartup();
    } catch (e) {
      ui.phase = "error";
      ui.error = t("The QGIS engine failed to start: {message}. qgis-js needs a recent Chromium or Firefox desktop browser.", { message: (e as Error).message });
    }
  });

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (!typing && e.key === "?") ui.shortcuts = true;
    else if (e.altKey && ui.phase === "ready" && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      (e.key === "ArrowLeft" ? previousView : nextView)();
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      ui.palette = !ui.palette;
    } else if (mod && ui.phase === "ready" && !typing && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
      e.preventDefault();
      const again = e.shiftKey || e.key.toLowerCase() === "y";
      // While editing, undo applies to feature edits; otherwise to project changes.
      if (ui.editing) again ? redo() : undo();
      else again ? redoProject() : undoProject();
    } else if (mod && !typing && ui.phase === "ready" && e.key.toLowerCase() === "c" && ui.current && ui.selection[ui.current]?.length && !getSelection()?.toString()) {
      copyFeatures(ui.current, ui.selection[ui.current]);
    } else if (mod && !typing && ui.editing && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteFeatures();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveInBrowser();
    } else if (mod && e.key.toLowerCase() === "o") {
      e.preventDefault();
      document.getElementById("pick-files")?.click();
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer && ui.phase !== "booting") openFiles(await droppedFiles(e.dataTransfer));
  }

  const onPick = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.length) openFiles(pickedFiles(input.files));
    input.value = "";
  };
</script>

<svelte:window onkeydown={onKey} onbeforeunload={(e) => { if (ui.dirty) e.preventDefault(); }} />

<div
  class="app"
  class:maponly={view.mapOnly}
  role="application"
  ondragover={(e) => { e.preventDefault(); if (!view.mapOnly) dragging = true; }}
  ondragleave={(e) => e.relatedTarget === null && (dragging = false)}
  ondrop={onDrop}
>
  {#if !view.mapOnly && !view.compact}
    <header class="topbar">
      <div class="brand"><span class="logo"></span>QGIS Web</div>
      <div class="project-name">
        {#if ui.phase === "ready"}<button title={t("Project properties")} onclick={() => (ui.dialog = "project")}>{ui.projectName}</button>{/if}{#if ui.dirty}<span class="dirty" title={t("Unsaved changes")}>•</span>{/if}
      </div>
      <button class="palette-btn" onclick={() => (ui.palette = true)}>
        <Icon name="search" size={16} /> {t("Search actions")} <kbd>Ctrl K</kbd>
      </button>
      <button class="icon" title={t("Undo (Ctrl+Z)")} aria-label={t("Undo")} disabled={!ui.canUndoProject || !!ui.editing} onclick={undoProject}><Icon name="undo" size={18} /></button>
      <button class="icon" title={t("Redo (Ctrl+Shift+Z)")} aria-label={t("Redo")} disabled={!ui.canRedoProject || !!ui.editing} onclick={redoProject}><Icon name="redo" size={18} /></button>
      <div class="menu-anchor">
        <button class="ghost" onclick={() => (saveMenu = !saveMenu)} disabled={ui.phase !== "ready"}><Icon name="save" size={18} /> {t("Save")}</button>
        {#if saveMenu}
          <div class="menu card right" role="menu">
            <button role="menuitem" onclick={() => { saveMenu = false; saveInBrowser(); }}>{t("Save in this browser")} <kbd>Ctrl S</kbd></button>
            <button role="menuitem" onclick={() => { saveMenu = false; downloadProject(); }}>{t("Download project file (.qgz)")}</button>
            <button role="menuitem" onclick={() => { saveMenu = false; downloadBundle(); }}>{t("Download project with data (.zip)")}</button>
          </div>
        {/if}
      </div>
      <button class="ghost" onclick={() => (ui.dialog = "share")} disabled={ui.phase !== "ready"}><Icon name="share" size={18} /> {t("Share")}</button>
      <button class="icon" title={t("Settings")} aria-label={t("Settings")} onclick={() => (ui.dialog = "settings")}><Icon name="settings" size={18} /></button>
    </header>
  {/if}

  <div class="body">
    {#if !view.mapOnly}
      <nav class="rail" aria-label={t("Panels")}>
        {#if view.compact}
          <button class="rail-btn" title={t("Menu")} onclick={() => (menuOpen = !menuOpen)}><Icon name="menu" /></button>
          {#if menuOpen}
            <div class="compact-menu">
              <button onclick={() => { ui.palette = true; menuOpen = false; }}>{t("Search actions…")}</button>
              <button onclick={() => { ui.dialog = "share"; menuOpen = false; }} disabled={ui.phase !== "ready"}>{t("Share…")}</button>
              <button onclick={() => { ui.dialog = "settings"; menuOpen = false; }}>{t("Settings…")}</button>
            </div>
          {/if}
        {/if}
        {#each rail as item}
          <button
            class="rail-btn"
            class:active={item.id === "table" ? !!ui.tableLayerId : ui.panel === item.id}
            disabled={!!item.planned || (item.id === "table" && !ui.current)}
            title={item.planned ? t("{label} — planned for {version}", { label: t(item.label), version: item.planned }) : t(item.label)}
            aria-label={t(item.label)}
            onclick={() => railClick(item.id)}
          >
            <Icon name={item.icon} />
          </button>
        {/each}
      </nav>

      {#if ui.panel}
        <aside class="panel">
          <header>
            <h2>{t(titles[ui.panel])}</h2>
            <button class="icon" aria-label={t("Close panel")} onclick={() => (ui.panel = null)}><Icon name="close" size={18} /></button>
          </header>
          <div class="panel-body">
            {#if ui.panel === "layers"}<LayersPanel />
            {:else if ui.panel === "add"}<AddDataPanel />
            {:else if ui.panel === "style"}<StylePanel />
            {:else if ui.panel === "tools"}<ToolsPanel />
            {:else if ui.panel === "hub"}<HubPanel />
            {:else if ui.panel === "bookmarks"}<BookmarksPanel />{/if}
          </div>
        </aside>
      {/if}
    {/if}

    <main class="main">
      <div class="map-area">
        <MapView />
        {#if ui.phase !== "ready"}<Welcome />{/if}
        {#if dragging}<div class="drop-hint">{t("Drop a QGIS project (.qgs / .qgz) with its data files or folder")}</div>{/if}
      </div>
      {#if ui.profile && !view.mapOnly}<ProfilePanel />{/if}
      {#if ui.tableLayerId && !view.mapOnly}
        {#key ui.tableLayerId}<AttributeTable layerId={ui.tableLayerId} />{/key}
      {/if}
    </main>
  </div>

  {#if ui.palette}<CommandPalette />{/if}
  {#if ui.dialog === "share"}<ShareDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.dialog === "project"}<ProjectDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.shortcuts}<ShortcutsDialog />{/if}
  {#if ui.dialog === "settings"}<SettingsDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.dialog === "export"}<ExportDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.layerPicker}{#key ui.layerPicker}<LayerPicker />{/key}{/if}
  {#if ui.csvPrompt}{#key ui.csvPrompt}<CsvDialog />{/key}{/if}
  {#if ui.current && ui.phase === "ready"}
    {#if ui.dialog === "select-location"}<SelectByLocation layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "export-layer"}<ExportLayerDialog layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "field-calc"}<FieldCalculator layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "select-expression"}
      <ExpressionBuilder layerId={ui.current} title={t("Select by expression")} onclose={() => (ui.dialog = null)} onapply={(v) => { selectByExpression(ui.current!, v, "new"); ui.dialog = null; }} />
    {/if}
  {/if}
  {#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}
  {#if ui.embedBlocked}
    <div class="embed-blocked">
      <div><h2>{t("This map can't be embedded here")}</h2><p class="muted">{t("Its owner allows embedding on: {hosts}", { hosts: ui.embedBlocked })}</p><a href={location.href} target="_blank" rel="noopener">{t("Open the map")}</a></div>
    </div>
  {/if}

  <input id="pick-files" type="file" multiple hidden onchange={onPick} />
  <input id="pick-folder" type="file" webkitdirectory hidden onchange={onPick} />
  <input id="pick-data" type="file" multiple hidden onchange={async (e) => { const i = e.currentTarget; if (i.files?.length) await addData(pickedFiles(i.files)); i.value = ""; }} />
</div>
