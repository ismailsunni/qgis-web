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
  import { selectByExpression } from "./lib/selection";

  const rail: { id: Panel | "table"; icon: "layers" | "add" | "style" | "table" | "tools" | "hub" | "bookmark"; label: string; planned?: string }[] = [
    { id: "layers", icon: "layers", label: "Layers" },
    { id: "add", icon: "add", label: "Add data" },
    { id: "style", icon: "style", label: "Style" },
    { id: "table", icon: "table", label: "Attribute table" },
    { id: "tools", icon: "tools", label: "Processing tools" },
    { id: "bookmarks", icon: "bookmark", label: "Bookmarks" },
    { id: "hub", icon: "hub", label: "QGIS Hub" },
  ];
  const titles: Record<Panel, string> = { layers: "Layers", add: "Add data", style: "Style", tools: "Processing", hub: "QGIS Hub", bookmarks: "Bookmarks" };

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
      ui.error = "This page can't run the QGIS engine inside an embedded frame. Open the map in its own tab.";
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
      ui.error = `The QGIS engine failed to start: ${(e as Error).message}. qgis-js needs a recent Chromium or Firefox desktop browser.`;
    }
  });

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      ui.palette = !ui.palette;
    } else if (mod && ui.phase === "ready" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
      e.preventDefault();
      const again = e.shiftKey || e.key.toLowerCase() === "y";
      // While editing, undo applies to feature edits; otherwise to project changes.
      if (ui.editing) again ? redo() : undo();
      else again ? redoProject() : undoProject();
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
        {#if ui.phase === "ready"}<button title="Project properties" onclick={() => (ui.dialog = "project")}>{ui.projectName}</button>{/if}{#if ui.dirty}<span class="dirty" title="Unsaved changes">•</span>{/if}
      </div>
      <button class="palette-btn" onclick={() => (ui.palette = true)}>
        <Icon name="search" size={16} /> Search actions <kbd>Ctrl K</kbd>
      </button>
      <button class="icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!ui.canUndoProject || !!ui.editing} onclick={undoProject}><Icon name="undo" size={18} /></button>
      <button class="icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!ui.canRedoProject || !!ui.editing} onclick={redoProject}><Icon name="redo" size={18} /></button>
      <div class="menu-anchor">
        <button class="ghost" onclick={() => (saveMenu = !saveMenu)} disabled={ui.phase !== "ready"}><Icon name="save" size={18} /> Save</button>
        {#if saveMenu}
          <div class="menu card right" role="menu">
            <button role="menuitem" onclick={() => { saveMenu = false; saveInBrowser(); }}>Save in this browser <kbd>Ctrl S</kbd></button>
            <button role="menuitem" onclick={() => { saveMenu = false; downloadProject(); }}>Download project file (.qgz)</button>
            <button role="menuitem" onclick={() => { saveMenu = false; downloadBundle(); }}>Download project with data (.zip)</button>
          </div>
        {/if}
      </div>
      <button class="ghost" onclick={() => (ui.dialog = "share")} disabled={ui.phase !== "ready"}><Icon name="share" size={18} /> Share</button>
      <button class="icon" title="Settings" aria-label="Settings" onclick={() => (ui.dialog = "settings")}><Icon name="settings" size={18} /></button>
    </header>
  {/if}

  <div class="body">
    {#if !view.mapOnly}
      <nav class="rail" aria-label="Panels">
        {#if view.compact}
          <button class="rail-btn" title="Menu" onclick={() => (menuOpen = !menuOpen)}><Icon name="menu" /></button>
          {#if menuOpen}
            <div class="compact-menu">
              <button onclick={() => { ui.palette = true; menuOpen = false; }}>Search actions…</button>
              <button onclick={() => { ui.dialog = "share"; menuOpen = false; }} disabled={ui.phase !== "ready"}>Share…</button>
              <button onclick={() => { ui.dialog = "settings"; menuOpen = false; }}>Settings…</button>
            </div>
          {/if}
        {/if}
        {#each rail as item}
          <button
            class="rail-btn"
            class:active={item.id === "table" ? !!ui.tableLayerId : ui.panel === item.id}
            disabled={!!item.planned || (item.id === "table" && !ui.current)}
            title={item.planned ? `${item.label} — planned for ${item.planned}` : item.label}
            aria-label={item.label}
            onclick={() => railClick(item.id)}
          >
            <Icon name={item.icon} />
          </button>
        {/each}
      </nav>

      {#if ui.panel}
        <aside class="panel">
          <header>
            <h2>{titles[ui.panel]}</h2>
            <button class="icon" aria-label="Close panel" onclick={() => (ui.panel = null)}><Icon name="close" size={18} /></button>
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
        {#if dragging}<div class="drop-hint">Drop a QGIS project (.qgs / .qgz) with its data files or folder</div>{/if}
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
  {#if ui.dialog === "settings"}<SettingsDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.dialog === "export"}<ExportDialog onclose={() => (ui.dialog = null)} />{/if}
  {#if ui.csvPrompt}{#key ui.csvPrompt}<CsvDialog />{/key}{/if}
  {#if ui.current && ui.phase === "ready"}
    {#if ui.dialog === "select-location"}<SelectByLocation layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "export-layer"}<ExportLayerDialog layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "field-calc"}<FieldCalculator layerId={ui.current} onclose={() => (ui.dialog = null)} />{/if}
    {#if ui.dialog === "select-expression"}
      <ExpressionBuilder layerId={ui.current} title="Select by expression" onclose={() => (ui.dialog = null)} onapply={(v) => { selectByExpression(ui.current!, v, "new"); ui.dialog = null; }} />
    {/if}
  {/if}
  {#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}
  {#if ui.embedBlocked}
    <div class="embed-blocked">
      <div><h2>This map can't be embedded here</h2><p class="muted">Its owner allows embedding on: {ui.embedBlocked}</p><a href={location.href} target="_blank" rel="noopener">Open the map</a></div>
    </div>
  {/if}

  <input id="pick-files" type="file" multiple hidden onchange={onPick} />
  <input id="pick-folder" type="file" webkitdirectory hidden onchange={onPick} />
  <input id="pick-data" type="file" multiple hidden onchange={async (e) => { const i = e.currentTarget; if (i.files?.length) await addData(pickedFiles(i.files)); i.value = ""; }} />
</div>
