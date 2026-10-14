import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { engine, readFile, writeFile, exists, listFiles } from "./engine";

/**
 * The open project as a QGIS XML document. It is the project file itself: every edit is
 * applied here, then QGIS reloads it, so what you see is exactly what gets saved.
 */
interface ProjectDoc {
  xml: XMLDocument;
  /** Session root in the virtual FS (everything that belongs to this project). */
  root: string;
  /** Folder and file name of the original project file. */
  dir: string;
  file: string;
  /** Other entries of the original .qgz (e.g. the auxiliary .qgd storage). */
  extra: Record<string, Uint8Array>;
  innerName: string;
  /** Engine-only overrides of a layer's source, e.g. a remote file cached locally. */
  local: Record<string, { datasource: string; provider: string }>;
}

let doc: ProjectDoc | null = null;
export const project = () => doc!;
export const hasProject = () => !!doc;

const parse = (text: string) => new DOMParser().parseFromString(text, "application/xml");

export function openDoc(path: string, root: string) {
  const bytes = readFile(path);
  const file = path.split("/").pop()!;
  let text: string;
  let extra: Record<string, Uint8Array> = {};
  let innerName = file;
  if (/\.qgz$/i.test(file)) {
    const entries = unzipSync(bytes);
    innerName = Object.keys(entries).find((n) => n.endsWith(".qgs"))!;
    text = strFromU8(entries[innerName]);
    delete entries[innerName];
    extra = entries;
  } else text = strFromU8(bytes);
  const xml = parse(text);
  if (xml.querySelector("parsererror") || !xml.querySelector("qgis")) throw new Error(`${file} is not a QGIS project`);
  doc = { xml, root, dir: path.slice(0, -file.length - 1), file, extra, innerName, local: {} };
  reload();
}

export function newDoc(root: string, xmlText: string, file = "untitled.qgz") {
  doc = { xml: parse(xmlText), root, dir: root, file, extra: {}, innerName: file.replace(/\.qgz$/, ".qgs"), local: {} };
  reload();
}

/** The project as QGIS should write it. */
export function serialize(xml = doc!.xml) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*>\s*/, "");
}

/** Path of the copy the engine reads; it sits next to the original so relative paths resolve. */
const enginePath = () => `${doc!.dir}/${doc!.file.replace(/\.(qgs|qgz)$/i, "")}.qgisweb.qgs`;

/** Writes the document for the engine and reloads it. */
export function reload() {
  const d = doc!;
  let xml = d.xml;
  if (Object.keys(d.local).length) {
    xml = d.xml.cloneNode(true) as XMLDocument;
    for (const [id, src] of Object.entries(d.local)) {
      const el = mapLayerEl(id, xml);
      if (!el) continue;
      child(el, "datasource").textContent = src.datasource;
      child(el, "provider").textContent = src.provider;
    }
  }
  writeFile(enginePath(), serialize(xml));
  if (!engine().loadProject(enginePath())) throw new Error("QGIS could not read the project");
}

export function projectBytes(): Uint8Array {
  const d = doc!;
  if (/\.qgs$/i.test(d.file)) return strToU8(serialize());
  return zipSync({ [d.innerName]: strToU8(serialize()), ...d.extra });
}

/** Files making up the project: data in the session folder plus the saved project file. */
export function projectFiles(): Record<string, Uint8Array> {
  const d = doc!;
  const out: Record<string, Uint8Array> = {};
  for (const p of listFilesSafe(d.root)) {
    if (p.endsWith(".qgisweb.qgs") || p === `${d.dir}/${d.file}`) continue;
    out[p.slice(d.root.length + 1)] = readFile(p);
  }
  out[`${d.dir}/${d.file}`.slice(d.root.length + 1)] = projectBytes();
  return out;
}

const listFilesSafe = (dir: string) => (exists(dir) ? listFiles(dir) : []);

// ---- XML helpers -------------------------------------------------------------------------

export function child(el: Element, tag: string): Element {
  let c = [...el.children].find((e) => e.tagName === tag);
  if (!c) {
    c = el.ownerDocument.createElement(tag);
    el.appendChild(c);
  }
  return c;
}

export const findChild = (el: Element, tag: string) => [...el.children].find((e) => e.tagName === tag) ?? null;

export function mapLayerEl(id: string, xml = doc!.xml) {
  return [...xml.querySelectorAll("projectlayers > maplayer")].find((m) => findChild(m, "id")?.textContent === id) ?? null;
}

export const treeRootEl = () => doc!.xml.querySelector("qgis > layer-tree-group")!;
export const isTreeNode = (e: Element) => e.tagName === "layer-tree-layer" || e.tagName === "layer-tree-group";
export const treeChildren = (e: Element) => [...e.children].filter(isTreeNode);

/** Tree element for a snapshot key ("0/2/1": child indices from the root). */
export function treeEl(key: string): Element {
  return key.split("/").reduce((el, i) => treeChildren(el)[+i], treeRootEl());
}

export function newLayerId(name: string) {
  return `${name.replace(/[^\w]/g, "_") || "layer"}_${crypto.randomUUID().replaceAll("-", "_")}`;
}

export function layerIds() {
  return [...doc!.xml.querySelectorAll("projectlayers > maplayer > id")].map((e) => e.textContent!);
}

/** Removes a layer from the project everywhere it is referenced. */
export function removeLayerXml(id: string) {
  mapLayerEl(id)?.remove();
  doc!.xml.querySelectorAll(`layer-tree-layer[id="${CSS.escape(id)}"]`).forEach((e) => e.remove());
  doc!.xml.querySelectorAll("custom-order > item, layerorder > layer").forEach((e) => {
    if (e.textContent === id || e.getAttribute("id") === id) e.remove();
  });
  delete doc!.local[id];
}

/** Adds a <maplayer> and its layer-tree node at the top of the tree (or into `group`). */
export function insertLayerXml(maplayer: Element | string, name: string, group: Element = treeRootEl()) {
  const xml = doc!.xml;
  const el = typeof maplayer === "string" ? xml.importNode(parse(maplayer).documentElement, true) : maplayer;
  let layers = xml.querySelector("qgis > projectlayers");
  if (!layers) layers = xml.documentElement.appendChild(xml.createElement("projectlayers"));
  layers.appendChild(el);
  const id = findChild(el, "id")!.textContent!;
  const node = xml.createElement("layer-tree-layer");
  node.setAttribute("id", id);
  node.setAttribute("name", name);
  node.setAttribute("checked", "Qt::Checked");
  node.setAttribute("expanded", "1");
  node.setAttribute("providerKey", findChild(el, "provider")?.textContent ?? "");
  node.setAttribute("source", findChild(el, "datasource")?.textContent ?? "");
  group.insertBefore(node, treeChildren(group)[0] ?? group.firstChild);
  const order = xml.querySelector("layer-tree-group > custom-order");
  if (order) order.insertBefore(Object.assign(xml.createElement("item"), { textContent: id }), order.firstChild);
  return id;
}

export function layerSource(id: string) {
  const el = mapLayerEl(id);
  return { provider: (el && findChild(el, "provider")?.textContent) ?? "", datasource: (el && findChild(el, "datasource")?.textContent) ?? "" };
}

const REMOTE_PROVIDERS = ["wms", "vectortile", "wfs", "arcgismapserver", "arcgisfeatureserver"];

/** Layers whose data the browser reads from the network instead of QGIS. */
export function isRemote(id: string) {
  const { provider, datasource } = layerSource(id);
  return REMOTE_PROVIDERS.includes(provider.toLowerCase()) || datasource.startsWith("/vsicurl/") || id in doc!.local;
}
