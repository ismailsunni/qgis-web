/** Credential stripping for published projects (F19). No dependencies, so it is unit-tested directly. */

export const SECRET_KEY = /^(authcfg|password|passwd|pwd|username|user|token|apikey|api_key|key|access_token|secret|sig|signature)$/i;

/** Drops credential query parameters from a URL. */
function cleanUrl(u: string) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (SECRET_KEY.test(k)) url.searchParams.delete(k);
    return url.href;
  } catch {
    return u;
  }
}

/** Removes credentials from a QGIS data source, in both key=value&… and key='value' syntaxes. */
export function cleanDatasource(ds: string) {
  if (/^\w+='/.test(ds.trim()) || /\s\w+='/.test(ds)) {
    return ds
      .replace(/\s*\b(\w+)='((?:[^'\\]|\\.)*)'/g, (m, k: string, v: string) => (SECRET_KEY.test(k) ? "" : k === "url" ? ` url='${cleanUrl(v)}'` : m))
      .trim();
  }
  if (!ds.includes("=") || ds.startsWith("/") || ds.startsWith(".")) return ds.replace(/^(\/vsicurl\/)(.*)$/, (_, p, u) => p + cleanUrl(u));
  return ds
    .split("&")
    .filter((kv) => !SECRET_KEY.test(kv.split("=")[0]))
    .map((kv) => {
      const [k, ...rest] = kv.split("=");
      if (k !== "url") return kv;
      const clean = cleanUrl(decodeURIComponent(rest.join("=")));
      return `url=${clean.replace(/%/g, "%25").replace(/&/g, "%26").replace(/=/g, "%3D").replace(/\{/g, "%7B").replace(/\}/g, "%7D").replace(/%25(7B|7D)/gi, "%$1")}`;
    })
    .join("&");
}

/** F19: removes authentication configs and credentials from every data source. */
export function stripSecrets(xml: XMLDocument) {
  for (const ds of xml.querySelectorAll("maplayer > datasource")) ds.textContent = cleanDatasource(ds.textContent ?? "");
  for (const n of xml.querySelectorAll("layer-tree-layer[source]")) n.setAttribute("source", cleanDatasource(n.getAttribute("source")!));
  xml.querySelectorAll("authcfg, AuthConfig").forEach((e) => e.remove());
  xml.querySelectorAll("[authcfg]").forEach((e) => e.removeAttribute("authcfg"));
}
