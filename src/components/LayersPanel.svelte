<script lang="ts">
  import { snapshotTree, addGroup, flatLayers } from "../lib/tree";
  import { canLink, chooseFolder, projectHandle } from "../lib/localfs";
  import { unavailableLayers, locateInFolder, locateInAllowed } from "../lib/relocate";
  import { toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { ui } from "../lib/state.svelte";
  import LayerNode from "./LayerNode.svelte";
  import { t } from "../lib/i18n";

  const tree = $derived.by(() => (ui.version, ui.phase === "ready" ? snapshotTree() : []));
  const blocked = $derived(flatLayers(tree).filter((l) => l.unreachable));
  const missing = $derived((ui.version, ui.phase === "ready" ? unavailableLayers() : []));

  // What to pick: the browser can't follow a path by itself, only inside a folder the user allows.
  const hint = $derived.by(() => {
    const p = missing[0]?.path ?? "";
    if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return t("Choose {folder} or a folder above it.", { folder: p.replace(/[\\/][^\\/]*$/, "") });
    if (p.startsWith("..")) return t("Choose a folder that holds both the project and {path} (their common parent).", { path: p });
    return t("Choose the project's folder.");
  });

  async function done(found: number) {
    const left = unavailableLayers().length;
    toast(left ? t("Found {n}; {left} still missing", { n: found, left }) : t("Found the data of {n} layers", { n: found }));
  }

  async function chooseRoot() {
    try {
      const before = missing.length;
      await locateInFolder(await chooseFolder(projectHandle()));
      ui.needsAccess = [];
      done(before - unavailableLayers().length);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message);
    }
  }

  async function allow(dir: FileSystemDirectoryHandle) {
    const before = missing.length;
    const still = await locateInAllowed([dir]);
    ui.needsAccess = ui.needsAccess.filter((d) => d !== dir && !still.includes(d));
    done(before - unavailableLayers().length);
  }
</script>

{#if ui.phase !== "ready"}
  <p class="muted">{t("Open a project to see its layers.")}</p>
{:else}
  <div class="toolbar">
    <button class="icon" title={t("Add group")} onclick={() => addGroup()}><Icon name="group" size={18} /></button>
    <button class="icon" title={t("Add data")} onclick={() => (ui.panel = "add")}><Icon name="add" size={18} /></button>
  </div>
  {#if blocked.length}
    <div class="notice warn-notice">
      <p>{blocked.length === 1 ? t("1 layer can't be loaded in a browser:") : t("{n} layers can't be loaded in a browser:", { n: blocked.length })}</p>
      <ul class="missing-files">
        {#each blocked.slice(0, 4) as l}<li>{l.name} <span class="muted">({l.unreachable!.kind === "database" ? l.unreachable!.name : t("QGIS saved login")})</span></li>{/each}
        {#if blocked.length > 4}<li>…</li>{/if}
      </ul>
      {#if blocked.some((l) => l.unreachable!.kind === "database")}
        <p class="hint">{t("A browser can't connect to a database. Serve the data as a web service and add that instead: pg_featureserv (OGC API Features), pg_tileserv (vector tiles) or QGIS Server (WMS/WFS). The layers stay in the project for QGIS Desktop.")}</p>
      {/if}
      {#if blocked.some((l) => l.unreachable!.kind === "login")}
        <p class="hint">{t("QGIS saved logins live in QGIS Desktop's password store. Use a service that doesn't need a login, or put the key in the URL.")}</p>
      {/if}
    </div>
  {/if}
  {#if missing.length}
    {@const paths = [...new Set(missing.map((u) => u.path))]}
    <div class="notice">
      <p>{missing.length === 1 ? t("1 layer can't find its data:") : t("{n} layers can't find their data:", { n: missing.length })}</p>
      <ul class="missing-files">
        {#each paths.slice(0, 4) as p}<li><code>{p}</code></li>{/each}
        {#if paths.length > 4}<li>…</li>{/if}
      </ul>
      {#if canLink}
        {#each ui.needsAccess.slice(0, 2) as dir}
          <button class="primary" onclick={() => allow(dir)}><Icon name="folder" size={16} /> {t("Allow access to “{name}”", { name: dir.name })}</button>
        {/each}
        <button class:primary={!ui.needsAccess.length} onclick={chooseRoot}><Icon name="folder" size={16} /> {t("Choose the folder with the data…")}</button>
        <p class="hint">{hint}</p>
      {/if}
      <button class="link" onclick={() => (ui.dialog = "unavailable")}>{t("More options…")}</button>
    </div>
  {/if}
  {#if !tree.length}<p class="muted pad">{t("This project has no layers yet. Add data to get started.")}</p>{/if}
  <ul class="tree" role="tree">
    {#each tree as node (node.key)}<LayerNode {node} />{/each}
  </ul>
  <p class="hint">{t("Click a layer to make it current, double-click to rename, drag to reorder.")}</p>
{/if}
