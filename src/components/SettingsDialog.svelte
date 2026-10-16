<script lang="ts">
  import { getSettings, saveSettings, lastProject, type ProjectRef, type Startup, type Theme } from "../lib/settings";
  import { listProjects, type StoredProject } from "../lib/storage";
  import { DEMO_URL } from "../lib/actions";
  import { ui, toast } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const initial = getSettings();
  let startup = $state<Startup>(initial.startup);
  let specific = $state<ProjectRef | null>(initial.specific);
  let theme = $state<Theme>(initial.theme);
  let stored = $state<StoredProject[]>([]);
  let url = $state(initial.specific?.kind === "url" ? initial.specific.url : "");
  listProjects().then((p) => (stored = p));
  const last = lastProject();

  const OPTIONS: [Startup, string, string][] = [
    ["welcome", "Welcome page", "Start screen with recent projects."],
    ["blank", "New project", "Start with an empty project."],
    ["last", "Most recent", "Reopen the last project you opened or saved."],
    ["specific", "Specific", "Always open the project chosen below."],
  ];

  /** The open project, if it can be reopened later (saved in the browser, or from a URL or share link). */
  const current = $derived<ProjectRef | null>(
    ui.phase !== "ready" ? null : ui.storedId ? { kind: "stored", id: ui.storedId, name: ui.projectName } : ui.sourceUrl ? { kind: "url", url: ui.sourceUrl, name: ui.projectName } : null,
  );

  const describe = (r: ProjectRef | null) =>
    !r ? "none" : r.kind === "stored" ? `${r.name} (saved in this browser)` : r.kind === "url" ? `${r.name} (${r.url})` : r.kind === "gist" ? `${r.name} (shared map)` : `${r.name} (local files, can't be reopened)`;

  function save() {
    if (startup === "specific" && !specific) return toast("Choose the project to open on launch.");
    saveSettings({ startup, specific, theme });
    toast("Settings saved");
    onclose();
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label="Settings">
    <header>
      <h2>Settings</h2>
      <button class="icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>
    <fieldset class="startup">
      <legend>Open project on launch</legend>
      {#each OPTIONS as [value, label, hint]}
        <label class="radio">
          <input type="radio" name="startup" {value} bind:group={startup} />
          <span><b>{label}</b> <span class="muted">{hint}</span></span>
        </label>
      {/each}
      {#if startup === "last"}
        <p class="hint">Last project: {describe(last)}</p>
      {/if}
      {#if startup === "specific"}
        <div class="specific">
          <p class="hint">Project: <b>{describe(specific)}</b></p>
          {#if current}<button onclick={() => (specific = current)}>Use the open project</button>{/if}
          {#if stored.length}
            <label class="field">Saved in this browser
              <select onchange={(e) => { const p = stored.find((s) => s.id === e.currentTarget.value); if (p) specific = { kind: "stored", id: p.id, name: p.name }; }}>
                <option value="">Choose…</option>
                {#each stored as p (p.id)}<option value={p.id} selected={specific?.kind === "stored" && specific.id === p.id}>{p.name}</option>{/each}
              </select>
            </label>
          {/if}
          <form class="row" onsubmit={(e) => { e.preventDefault(); if (url) specific = { kind: "url", url: new URL(url, location.href).href, name: decodeURIComponent(url.split("/").pop() ?? url) }; }}>
            <input type="url" placeholder="Project URL (https://…/project.qgz)" bind:value={url} />
            <button type="submit">Use URL</button>
          </form>
          <button class="link" onclick={() => (specific = { kind: "url", url: new URL(DEMO_URL, location.href).href, name: "Demo project" })}>Use the demo project</button>
        </div>
      {/if}
    </fieldset>
    <p class="hint">A link with <code>?url=</code> or <code>?gist=</code> always opens that project instead.</p>
    <label class="field">Theme
      <select bind:value={theme} onchange={() => saveSettings({ theme })}>
        <option value="system">Follow the system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <footer>
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={save}>Save</button>
    </footer>
  </div>
</div>
