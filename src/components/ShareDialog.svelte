<script lang="ts">
  import { t, N_ } from "../lib/i18n";
  import { ui, toast } from "../lib/state.svelte";
  import * as P from "../lib/publish";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const base = `${location.origin}${location.pathname}`;
  let copied = $state("");
  let blockers = $state<P.LayerCheck[]>([]);
  let warnings = $state<P.LayerCheck[] | null>(null);
  let resources = $state<{ embedded: number; missing: string[] }>({ embedded: 0, missing: [] });
  const initial = P.publishedRef();
  let ref = $state(initial);
  let isPublic = $state(initial?.public ?? false);
  let mode = $state<"compact" | "maponly">("compact");
  let domains = $state("");
  let token = $state(P.getToken());
  let busy = $state(false);
  let versions = $state<{ version: string; committedAt: string }[]>([]);

  blockers = P.localLayers();
  resources = P.publishableProject().resources;
  P.remoteProblems().then((w) => (warnings = w));
  if (initial) P.history(initial.id).then((v) => (versions = v)).catch(() => {});

  const shareLink = (extra: string) => `${base}?gist=${ref!.owner}/${ref!.id}${extra}`;
  const embed = () => `<iframe src="${shareLink("&maponly")}" width="800" height="500" style="border:0" allow="cross-origin-isolated"></iframe>`;

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    copied = what;
  }

  async function doPublish() {
    busy = true;
    try {
      P.setToken(token.trim());
      const r = await P.publish(
        { name: ui.projectName, mode, allowedDomains: domains.split(/[\s,]+/).filter(Boolean), publishedAt: new Date().toISOString() },
        { gistId: ref?.id, public: isPublic },
      );
      ref = { owner: r.owner, id: r.id, public: r.public };
      P.setPublishedRef(ref);
      ui.dirty = true;
      versions = await P.history(r.id).catch(() => []);
      toast(versions.length > 1 ? t("Republished: the link now shows this version") : t("Published"));
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }

  async function restore(v: string) {
    busy = true;
    try {
      await P.restore(ref!.id, v);
      versions = await P.history(ref!.id);
      toast(t("Restored: the link shows that version again"));
    } catch (e) {
      toast((e as Error).message);
    }
    busy = false;
  }
</script>

<div class="overlay modal" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog card share" role="dialog" aria-modal="true" aria-label={t("Share")}>
    <header>
      <h2>{t("Share")}</h2>
      <button class="icon" aria-label={t("Close")} onclick={onclose}><Icon name="close" size={18} /></button>
    </header>

    {#if ui.sourceUrl}
      <section class="share-section">
        <h3>{t("Link to the project URL")}</h3>
        {#each [[N_("Full app"), `${base}?url=${encodeURIComponent(ui.sourceUrl)}`], [N_("Map only"), `${base}?url=${encodeURIComponent(ui.sourceUrl)}&maponly`]] as [label, text]}
          <div class="row"><span class="share-label">{t(label)}</span><input readonly value={text} /><button onclick={() => copy(text, label)}>{copied === label ? t("Copied") : t("Copy")}</button></div>
        {/each}
      </section>
    {/if}

    <section class="share-section">
      <h3>{t("Publish a share link")}</h3>
      <p class="hint">{t("Only the project file is published (as a GitHub gist). Layers must read their data from the web, so your data is never uploaded.")}</p>
      {#if blockers.length}
        <div class="check error">
          <strong>{t("Can't publish: these layers use local data")}</strong>
          <ul>{#each blockers as b}<li><b>{b.name}</b> {b.detail}</li>{/each}</ul>
          <p class="hint">{t("Use remote sources (XYZ, WMS, WMTS, WFS, vector tiles, or files by URL), or remove these layers.")}</p>
        </div>
      {:else}
        {#if warnings === null}<p class="hint">{t("Checking remote layers…")}</p>{/if}
        {#if warnings?.length}
          <div class="check warn">
            <strong>{t("Viewers may see errors for:")}</strong>
            <ul>{#each warnings as w}<li><b>{w.name}</b>: {w.detail}</li>{/each}</ul>
          </div>
        {/if}
        {#if resources.embedded}<p class="hint">{t("{n} local SVG/image file(s) will be embedded in the project.", { n: resources.embedded })}</p>{/if}
        {#if resources.missing.length}<p class="hint">{t("Missing local images: {list}", { list: resources.missing.join(", ") })}</p>{/if}
        <div class="grid2">
          <label class="field">{t("Visibility")}
            <select bind:value={isPublic} disabled={!!ref}><option value={false}>{t("Unlisted (link only)")}</option><option value={true}>{t("Public")}</option></select>
          </label>
          <label class="field">{t("Opens as")}
            <select bind:value={mode}><option value="compact">{t("Compact app")}</option><option value="maponly">{t("Map only")}</option></select>
          </label>
        </div>
        <label class="field">{t("Embedding allowed on (domains, empty for any)")}
          <input bind:value={domains} placeholder="example.org, intranet.example.com" />
        </label>
        <label class="field">{t("GitHub token (gist scope, stored only in this browser)")}
          <input type="password" bind:value={token} placeholder="ghp_…" />
        </label>
        <a class="hint" href="https://github.com/settings/tokens/new?scopes=gist&description=QGIS%20Web" target="_blank" rel="noopener">{t("Create a token with the “gist” scope")}</a>
        <button class="primary" disabled={busy || !token} onclick={doPublish}>{busy ? t("Publishing…") : ref ? t("Republish (same link)") : t("Publish")}</button>
      {/if}
    </section>

    {#if ref}
      <section class="share-section">
        <h3>{t("Links")}</h3>
        {#each [[N_("App"), shareLink(mode === "compact" ? "&layout=compact" : "&maponly")], [N_("Map only"), shareLink("&maponly")], [N_("Embed"), embed()]] as [label, text]}
          <div class="row"><span class="share-label">{t(label)}</span><input readonly value={text} onfocus={(e) => e.currentTarget.select()} /><button onclick={() => copy(text, label)}>{copied === label ? t("Copied") : t("Copy")}</button></div>
        {/each}
        {#if versions.length}
          <details>
            <summary>{t("Version history ({n})", { n: versions.length })}</summary>
            <ul class="versions">
              {#each versions as v, i}
                <li>
                  <span>{new Date(v.committedAt).toLocaleString()}</span>
                  {#if i === 0}<span class="muted">{t("current")}</span>{:else}
                    <a href={shareLink(`&rev=${v.version}`)} target="_blank" rel="noopener">{t("view")}</a>
                    <button disabled={busy} onclick={() => restore(v.version)}>{t("Restore")}</button>
                  {/if}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </section>
    {/if}
  </div>
</div>
