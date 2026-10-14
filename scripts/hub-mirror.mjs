// Mirrors the QGIS Hub catalog (styles, GeoPackage projects, layer definitions) into public/hub/
// so the app can browse it: hub.qgis.org doesn't send CORS headers. Run before building:
//   node scripts/hub-mirror.mjs
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://hub.qgis.org/api/v1/resources/";
const TYPES = ["style", "geopackage", "layerdefinition"];
const MAX_BYTES = 25e6;
const OUT = new URL("../public/hub/", import.meta.url);

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function download(url, path) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    await writeFile(new URL(path, OUT), buf);
    return path;
  } catch {
    return null;
  }
}

/** Runs async jobs with limited concurrency. */
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

await mkdir(new URL("files/", OUT), { recursive: true });
await mkdir(new URL("thumbs/", OUT), { recursive: true });
const resources = [];
for (const type of TYPES) {
  for (let url = `${API}?resource_type=${type}&limit=100`; url; ) {
    const page = await json(url);
    resources.push(...page.results);
    url = page.next;
  }
}
console.log(`${resources.length} resources`);
const index = await pool(resources, 8, async (r) => {
  const ext = r.file.split("/").pop().split(".").slice(1).join(".") || "bin";
  const [file, thumb] = await Promise.all([
    download(r.file, `files/${r.uuid}.${ext}`),
    r.thumbnail ? download(r.thumbnail, `thumbs/${r.uuid}.jpg`) : null,
  ]);
  return {
    uuid: r.uuid,
    type: r.resource_type,
    subtypes: r.resource_subtypes,
    name: r.name,
    creator: r.creator?.trim(),
    date: r.upload_date?.slice(0, 10),
    downloads: r.download_count,
    description: r.description,
    file,
    fileName: r.file.split("/").pop(),
    thumb,
    source: r.file,
  };
});
await writeFile(new URL("index.json", OUT), JSON.stringify({ updated: new Date().toISOString(), resources: index.filter((r) => r.file) }));
console.log(`mirrored ${index.filter((r) => r.file).length} files`);
