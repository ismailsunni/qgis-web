<script lang="ts">
  import { onMount } from "svelte";
  import { boot } from "./lib/engine";
  import { ui, view, type Panel } from "./lib/state.svelte";
  import { droppedFiles, openFiles, openUrl, pickedFiles, saveInBrowser, downloadProject, downloadBundle } from "./lib/actions";
  import Icon from "./components/Icon.svelte";
  import MapView from "./components/MapView.svelte";
  import LayersPanel from "./components/LayersPanel.svelte";
  import AddDataPanel from "./components/AddDataPanel.svelte";
  import StylePanel from "./components/StylePanel.svelte";
  import AttributeTable from "./components/AttributeTable.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import Welcome from "./components/Welcome.svelte";
  import ShareDialog from "./components/ShareDialog.svelte";

  const rail: { id: Panel | "table"; icon: "layers" | "add" | "style" | "table" | "tools" | "hub"; label: string; planned?: string }[] = [
    { id: "layers", icon: "layers", label: "Layers" },
    { id: "add", icon: "add", label: "Add data" },
    { id: "style", icon: "style", label: "Style" },
    { id: "table", icon: "table", label: "Attribute table" },
    { id: "tools", icon: "tools", label: "Processing tools", planned: "M4" },
    { id: "hub", icon: "hub", label: "QGIS Hub", planned: "M4" },
  ];
  const titles: Record<Panel, string> = { layers: "Layers", add: "Add data", style: "Style", tools: "Tools", hub: "Hub" };

  let dragging = $state(false);
  let menuOpen = $state(false);
  let shareOpen = $state(false);
  let saveMenu = $state(false);

  function railClick(id: Panel | "table") {
    if (id === "table") ui.tableLayerId = ui.tableLayerId ? null : ui.current;
    else ui.panel = ui.panel === id ? null : id;
  }

  onMount(async () => {
    try {
      await boot((s) => s && (ui.status = s));
      ui.phase = "empty";
      if (view.url) await openUrl(view.url);
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
      <div class="project-name" title={ui.projectName}>{ui.projectName}{#if ui.dirty}<span class="dirty" title="Unsaved changes"> •</span>{/if}</div>
      <button class="palette-btn" onclick={() => (ui.palette = true)}>
        <Icon name="search" size={16} /> Search actions <kbd>Ctrl K</kbd>
      </button>
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
      <button class="ghost" onclick={() => (shareOpen = true)} disabled={ui.phase !== "ready"}><Icon name="share" size={18} /> Share</button>
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
              <button onclick={() => { shareOpen = true; menuOpen = false; }} disabled={ui.phase !== "ready"}>Share…</button>
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
            {:else if ui.panel === "style"}<StylePanel />{/if}
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
      {#if ui.tableLayerId && !view.mapOnly}
        {#key ui.tableLayerId}<AttributeTable layerId={ui.tableLayerId} />{/key}
      {/if}
    </main>
  </div>

  {#if ui.palette}<CommandPalette />{/if}
  {#if shareOpen}<ShareDialog onclose={() => (shareOpen = false)} />{/if}
  {#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}

  <input id="pick-files" type="file" multiple hidden onchange={onPick} />
  <input id="pick-folder" type="file" webkitdirectory hidden onchange={onPick} />
</div>
