<script lang="ts">
  import { getSettings, saveSettings, exportSettings, importSettings, lastProject, type ProjectRef, type Startup, type Theme } from "../lib/settings";
  import { listProjects, type StoredProject } from "../lib/storage";
  import { DEMO_URL } from "../lib/actions";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import { LANGUAGES, t, N_ } from "../lib/i18n";

  let { onclose }: { onclose: () => void } = $props();

  const initial = getSettings();
  let startup = $state<Startup>(initial.startup);
  let specific = $state<ProjectRef | null>(initial.specific);
  let theme = $state<Theme>(initial.theme);
  let mapView = $state(initial.view);
  let language = $state(initial.language);
  let stored = $state<StoredProject[]>([]);
  let url = $state(initial.specific?.kind === "url" ? initial.specific.url : "");
  listProjects().then((p) => (stored = p));
  const last = lastProject();

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(exportSettings());
    a.download = "quarkgis-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function load(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importSettings(await file.text());
      toast(t("Settings imported"));
      onclose();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const OPTIONS: [Startup, string, string][] = [
    ["welcome", N_("Welcome page"), N_("Start screen with recent projects.")],
    ["blank", N_("New project"), N_("Start with an empty project.")],
    ["last", N_("Most recent"), N_("Reopen the last project you opened or saved.")],
    ["specific", N_("Specific"), N_("Always open the project chosen below.")],
  ];

  /** The open project, if it can be reopened later (saved in the browser, or from a URL or share link). */
  const current = $derived<ProjectRef | null>(
    ui.phase !== "ready" ? null : ui.storedId ? { kind: "stored", id: ui.storedId, name: ui.projectName } : ui.sourceUrl ? { kind: "url", url: ui.sourceUrl, name: ui.projectName } : null,
  );

  const describe = (r: ProjectRef | null) =>
    !r ? t("none") : r.kind === "stored" ? t("{name} (saved in this browser)", { name: r.name }) : r.kind === "url" ? `${r.name} (${r.url})` : r.kind === "gist" ? t("{name} (shared map)", { name: r.name }) : t("{name} (local files, can't be reopened)", { name: r.name });

  function save() {
    if (startup === "specific" && !specific) return toast(t("Choose the project to open on launch."));
    saveSettings({ startup, specific, theme, view: mapView, language });
    // Translations are applied when the app starts.
    if (language !== initial.language) location.reload();
    toast(t("Settings saved"));
    onclose();
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={t("Settings")}>
    <header>
      <h2>{t("Settings")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <fieldset class="startup">
      <legend>{t("Open project on launch")}</legend>
      {#each OPTIONS as [value, label, hint]}
        <label class="radio">
          <input type="radio" name="startup" {value} bind:group={startup} />
          <span><b>{t(label)}</b> <span class="muted">{t(hint)}</span></span>
        </label>
      {/each}
      {#if startup === "last"}
        <p class="hint">{t("Last project: {project}", { project: describe(last) })}</p>
      {/if}
      {#if startup === "specific"}
        <div class="specific">
          <p class="hint">{t("Project:")} <b>{describe(specific)}</b></p>
          {#if current}<button onclick={() => (specific = current)}>{t("Use the open project")}</button>{/if}
          {#if stored.length}
            <label class="field">{t("Saved in this browser")}
              <select onchange={(e) => { const p = stored.find((s) => s.id === e.currentTarget.value); if (p) specific = { kind: "stored", id: p.id, name: p.name }; }}>
                <option value="">{t("Choose…")}</option>
                {#each stored as p (p.id)}<option value={p.id} selected={specific?.kind === "stored" && specific.id === p.id}>{p.name}</option>{/each}
              </select>
            </label>
          {/if}
          <form class="row" onsubmit={(e) => { e.preventDefault(); if (url) specific = { kind: "url", url: new URL(url, location.href).href, name: decodeURIComponent(url.split("/").pop() ?? url) }; }}>
            <input type="url" placeholder={t("Project URL (https://…/project.qgz)")} bind:value={url} />
            <button type="submit">{t("Use URL")}</button>
          </form>
          <button class="link" onclick={() => (specific = { kind: "url", url: new URL(DEMO_URL, location.href).href, name: t("Demo project") })}>{t("Use the demo project")}</button>
        </div>
      {/if}
    </fieldset>
    <p class="hint">{@html t("A link with {url} or {gist} always opens that project instead.", { url: "<code>?url=</code>", gist: "<code>?gist=</code>" })}</p>
    <label class="field">{t("Theme")}
      <select bind:value={theme} onchange={() => saveSettings({ theme })}>
        <option value="system">{t("Follow the system")}</option>
        <option value="light">{t("Light")}</option>
        <option value="dark">{t("Dark")}</option>
      </select>
    </label>
    <label class="field">{t("Language")}
      <select bind:value={language}>
        <option value="auto">{t("Browser language")}</option>
        {#each Object.entries(LANGUAGES) as [code, name]}<option value={code}>{name}</option>{/each}
      </select>
    </label>
    <label class="field">{t("Map view when a project opens")}
      <select bind:value={mapView}>
        <option value="saved">{t("The view saved in the project (as QGIS)")}</option>
        <option value="full">{t("Full extent of the project's layers")}</option>
      </select>
    </label>
    <div class="row">
      <button onclick={download}><Icon name="download" size={16} /> {t("Export settings")}</button>
      <label class="button-like"><Icon name="upload" size={16} /> {t("Import settings")}<input type="file" accept=".json,application/json" hidden onchange={load} /></label>
    </div>
    <footer>
      <button onclick={onclose}>{t("Cancel")}</button>
      <button class="primary" onclick={save}>{t("Save")}</button>
    </footer>
  </div>
</div>
