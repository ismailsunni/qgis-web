import { unzipSync } from "fflate";
import { findChild, insertLayerXml, layerIds, newLayerId, project, treeRootEl } from "./doc";
import { apply } from "./commit";
import { readRenderer, setCategorized, setGraduated, setSingle, symbolKind, uniqueCategories, classify, RAMPS, toHex, writeLabels, readLabels } from "./style";
import { openFiles } from "./actions";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";

/** QGIS Hub resources, mirrored at build time (scripts/hub-mirror.mjs). */
export interface HubResource {
  uuid: string;
  type: "Style" | "Geopackage" | "LayerDefinition";
  subtypes: string | null;
  name: string;
  creator: string;
  date: string;
  downloads: number;
  description: string;
  file: string;
  fileName: string;
  thumb: string | null;
  source: string;
}

const base = `${import.meta.env.BASE_URL}hub/`;
export const hubUrl = (path: string) => base + path;

export async function hubIndex(): Promise<{ updated: string; resources: HubResource[] }> {
  const r = await fetch(hubUrl("index.json"));
  if (!r.ok) throw new Error(t("The Hub mirror is not available in this build"));
  return r.json();
}

async function fetchFile(r: HubResource) {
  return new Uint8Array(await (await fetch(hubUrl(r.file))).arrayBuffer());
}

export async function styleDoc(r: HubResource) {
  return new DOMParser().parseFromString(new TextDecoder().decode(await fetchFile(r)), "application/xml");
}

/** What a style file can do for the current layer. */
export function styleContents(xml: XMLDocument) {
  return {
    symbols: [...xml.querySelectorAll("qgis_style > symbols > symbol")],
    ramps: [...xml.querySelectorAll("qgis_style > colorramps > colorramp")],
    textformats: [...xml.querySelectorAll("qgis_style > textformats > textformat")],
    labelsettings: [...xml.querySelectorAll("qgis_style > labelsettings > labelsetting")],
  };
}

const KIND = { marker: "marker", line: "line", fill: "fill" } as const;

/** Uses a Hub symbol as the layer's symbol (single symbol, or the base of its classes). */
export function applySymbol(layerId: string, symbol: Element) {
  const kind = symbolKind(layerId);
  if (symbol.getAttribute("type") !== KIND[kind ?? "fill"]) return toast(t("This is a {type} symbol; the layer needs a {kind} symbol.", { type: String(symbol.getAttribute("type")), kind: String(kind) }));
  const sym = project().xml.importNode(symbol, true) as Element;
  apply(() => setSingle(layerId, sym));
}

/** Colors of a QGIS color ramp element (gradient or preset); cpt-city ramps need QGIS's library. */
export function rampStops(ramp: Element): string[] | null {
  const props = Object.fromEntries([...ramp.querySelectorAll("prop, Option[name] > Option[name]")].map((p) => [p.getAttribute("k") ?? p.getAttribute("name"), p.getAttribute("v") ?? p.getAttribute("value")]));
  const type = ramp.getAttribute("type");
  if (type === "gradient") {
    const stops = (props.stops ?? "").split(":").filter(Boolean).map((s: string) => toHex(s.split(";")[1]));
    return [toHex(props.color1), ...stops, toHex(props.color2)];
  }
  if (type === "preset") return Object.keys(props).filter((k) => /^preset_color_\d+$/.test(k)).map((k) => toHex(props[k]));
  return null;
}

/** Reclassifies the current categorized/graduated renderer with a Hub color ramp. */
export function applyRamp(layerId: string, ramp: Element) {
  const stops = rampStops(ramp);
  if (!stops) return toast(t("“{type}” ramps can't be used in the browser yet.", { type: String(ramp.getAttribute("type")) }));
  const name = `Hub: ${ramp.getAttribute("name")}`;
  RAMPS[name] = { stops };
  const r = readRenderer(layerId);
  if (r.type === "categorizedSymbol") apply(() => setCategorized(layerId, r.attr, uniqueCategories(layerId, r.attr, name), name));
  else if (r.type === "graduatedSymbol") apply(() => setGraduated(layerId, r.attr, classify(layerId, r.attr, r.mode, r.ranges.length || 5, name), name, r.mode));
  else toast(t("Switch the layer to Categorized or Graduated first; the ramp is now in the ramp list."));
}

/** Applies a Hub text format (font, size, color, buffer…) to the layer's labels. */
export function applyTextFormat(layerId: string, format: Element) {
  const style = format.querySelector("text-style");
  if (!style) return;
  apply(() => {
    const l = readLabels(layerId);
    writeLabels(layerId, { ...l, enabled: true });
    const current = findLayerTextStyle(layerId);
    if (!current) return;
    const imported = project().xml.importNode(style, true) as Element;
    for (const a of ["fieldName", "isExpression"]) imported.setAttribute(a, current.getAttribute(a) ?? "");
    current.replaceWith(imported);
  });
}

function findLayerTextStyle(layerId: string) {
  const el = [...project().xml.querySelectorAll("projectlayers > maplayer")].find((m) => findChild(m, "id")?.textContent === layerId);
  return el?.querySelector("labeling > settings > text-style") ?? null;
}

/** Opens a Hub GeoPackage (or zip) that carries a QGIS project. */
export async function openHubProject(r: HubResource) {
  const bytes = await fetchFile(r);
  const files = /\.zip$/i.test(r.fileName)
    ? Object.entries(unzipSync(bytes)).filter(([n]) => !n.endsWith("/") && !n.startsWith("__MACOSX")).map(([path, data]) => ({ path, data: new File([data as Uint8Array<ArrayBuffer>], path.split("/").pop()!) }))
    : [{ path: r.fileName, data: new File([bytes as Uint8Array<ArrayBuffer>], r.fileName) }];
  ui.phase = "empty";
  await openFiles(files);
  if ((ui.phase as string) === "ready") ui.projectName = r.name;
}

/** Adds the layers of a Hub layer definition (.qlr) to the project. */
export async function addLayerDefinition(r: HubResource) {
  if (ui.phase !== "ready") {
    const { newProject } = await import("./actions");
    await newProject();
  }
  const qlr = new DOMParser().parseFromString(new TextDecoder().decode(await fetchFile(r)), "application/xml");
  const existing = new Set(layerIds());
  apply(() => {
    const xml = project().xml;
    const renamed = new Map<string, string>();
    for (const m of qlr.querySelectorAll("maplayers > maplayer")) {
      const el = xml.importNode(m, true) as Element;
      const idEl = findChild(el, "id")!;
      const name = findChild(el, "layername")?.textContent ?? r.name;
      if (existing.has(idEl.textContent!)) {
        const id = newLayerId(name);
        renamed.set(idEl.textContent!, id);
        idEl.textContent = id;
      }
      // insertLayerXml adds a flat tree node; the QLR's own grouping is rebuilt below.
      insertLayerXml(el, name);
      xml.querySelector(`layer-tree-layer[id="${CSS.escape(idEl.textContent!)}"]`)?.remove();
    }
    const group = qlr.querySelector("layer-tree-group");
    if (!group) return;
    const node = xml.importNode(group, true) as Element;
    node.querySelectorAll("layer-tree-layer").forEach((l) => renamed.has(l.getAttribute("id")!) && l.setAttribute("id", renamed.get(l.getAttribute("id")!)!));
    if (!node.getAttribute("name")) node.setAttribute("name", r.name);
    const root = treeRootEl();
    root.insertBefore(node, root.firstElementChild);
  });
  toast(t("Added “{name}”", { name: r.name }));
}
