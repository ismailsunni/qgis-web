import { FeatureRequestFlag, GeometryType, type QgsVectorLayer } from "qgis-js";
import templatesXml from "../templates/style.xml?raw";
import renderersXml from "../templates/renderers.xml?raw";
import { child, findChild, mapLayerEl, project } from "./doc";
import { engine, findMapLayer, free } from "./engine";

/** Style editing on the layer's XML, in the exact format QGIS reads and writes. */

const templates = new DOMParser().parseFromString(templatesXml, "application/xml");
export type SymbolKind = "marker" | "line" | "fill";

const uuid = () => `{${crypto.randomUUID()}}`;

// ---- Colors ----------------------------------------------------------------------------

export const toHex = (qgis: string | null) => {
  const [r, g, b] = (qgis ?? "0,0,0").split(",").map(Number);
  return "#" + [r, g, b].map((v) => (v || 0).toString(16).padStart(2, "0")).join("");
};
export const alphaOf = (qgis: string | null) => (Number((qgis ?? "").split(",")[3] ?? 255) || 0) / 255;
export const toQgis = (hex: string, alpha = 1) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",") + "," + Math.round(alpha * 255);

const lerp = (a: string, b: string, t: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");

/** Color ramps; sequential ones are interpolated, qualitative ones cycle. */
export const RAMPS: Record<string, { stops: string[]; qualitative?: boolean }> = {
  Pastel: { stops: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd"], qualitative: true },
  Bold: { stops: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf", "#999999"], qualitative: true },
  Viridis: { stops: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"] },
  Blues: { stops: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"] },
  Reds: { stops: ["#fff5f0", "#fcbba1", "#fb6a4a", "#cb181d", "#67000d"] },
  Greens: { stops: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"] },
  YlOrRd: { stops: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"] },
  Spectral: { stops: ["#d7191c", "#fdae61", "#ffffbf", "#abdda4", "#2b83ba"] },
};

export function rampColors(name: string, n: number): string[] {
  const { stops, qualitative } = RAMPS[name] ?? RAMPS.Pastel;
  if (qualitative) return Array.from({ length: n }, (_, i) => stops[i % stops.length]);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const pos = t * (stops.length - 1);
    const k = Math.min(Math.floor(pos), stops.length - 2);
    return lerp(stops[k], stops[k + 1], pos - k);
  });
}

// ---- Symbols ---------------------------------------------------------------------------

export function templateSymbol(kind: SymbolKind): Element {
  const s = templates.querySelector(`templates > symbol[name="${kind}"]`)!;
  return project().xml.importNode(s, true) as Element;
}

const option = (layer: Element, name: string) => layer.querySelector(`:scope > Option > Option[name="${name}"]`);

function setOption(layer: Element, name: string, value: string) {
  let o = option(layer, name);
  if (!o) {
    o = layer.ownerDocument.createElement("Option");
    o.setAttribute("name", name);
    o.setAttribute("type", "QString");
    child(layer, "Option").setAttribute("type", "Map");
    child(layer, "Option").appendChild(o);
  }
  o.setAttribute("value", value);
}

/** The editable properties of a symbol's first (bottom) symbol layer. */
export interface SymbolProps {
  kind: SymbolKind;
  cls: string;
  color: string;
  stroke: string;
  strokeWidth: number;
  size: number;
  opacity: number;
}

const FILL_KEYS: Record<string, [string, string, string, string]> = {
  // class: [fill color, stroke color, stroke width, size]
  SimpleFill: ["color", "outline_color", "outline_width", ""],
  SimpleLine: ["line_color", "", "", "line_width"],
  SimpleMarker: ["color", "outline_color", "outline_width", "size"],
};

export function readSymbol(sym: Element): SymbolProps {
  const layer = sym.querySelector(":scope > layer")!;
  const cls = layer?.getAttribute("class") ?? "";
  const [c, s, w, z] = FILL_KEYS[cls] ?? ["color", "outline_color", "outline_width", "size"];
  const val = (k: string) => (k ? option(layer, k)?.getAttribute("value") ?? null : null);
  return {
    kind: sym.getAttribute("type") as SymbolKind,
    cls,
    color: toHex(val(c)),
    stroke: toHex(val(s)),
    strokeWidth: Number(val(w) ?? 0.26),
    size: Number(val(z) ?? 0),
    opacity: Number(sym.getAttribute("alpha") ?? 1),
  };
}

export function writeSymbol(sym: Element, p: Partial<SymbolProps>) {
  const layer = sym.querySelector(":scope > layer");
  if (!layer) return;
  const [c, s, w, z] = FILL_KEYS[layer.getAttribute("class") ?? ""] ?? ["color", "outline_color", "outline_width", "size"];
  if (p.color && c) setOption(layer, c, toQgis(p.color));
  if (p.stroke && s) setOption(layer, s, toQgis(p.stroke));
  if (p.strokeWidth !== undefined && w) setOption(layer, w, String(p.strokeWidth));
  if (p.size !== undefined && z) setOption(layer, z, String(p.size));
  if (p.opacity !== undefined) sym.setAttribute("alpha", String(p.opacity));
}

function cloneSymbol(sym: Element, name: string, color?: string) {
  const c = sym.cloneNode(true) as Element;
  c.setAttribute("name", name);
  c.querySelectorAll("layer").forEach((l) => l.setAttribute("id", uuid()));
  if (color) writeSymbol(c, { color });
  return c;
}

// ---- Renderers -------------------------------------------------------------------------

export type RendererType = "singleSymbol" | "categorizedSymbol" | "graduatedSymbol";

export interface Category { value: string; label: string; color: string; render: boolean }
export interface Range { lower: number; upper: number; label: string; color: string; render: boolean }

export interface RendererState {
  type: string;
  base: Element | null;
  attr: string;
  categories: Category[];
  ranges: Range[];
  ramp: string;
  mode: string;
}

const layerEl = (id: string) => mapLayerEl(id)!;
const rendererEl = (id: string) => findChild(layerEl(id), "renderer-v2");

/** Geometry family of a vector layer, from the project or the first feature. */
export function symbolKind(id: string): SymbolKind | null {
  const g = layerEl(id).getAttribute("geometry");
  if (g) return g === "Point" ? "marker" : g === "Line" ? "line" : g === "Polygon" ? "fill" : null;
  const layer = findMapLayer(id) as QgsVectorLayer | null;
  if (!layer) return null;
  const it = layer.getFeatures();
  const f = it.nextFeature();
  const type = f?.hasGeometry() ? engine().QgsWkbTypes.geometryType(f.geometry().wkbType()) : GeometryType.Unknown;
  free(f);
  free(it);
  return type === GeometryType.Point ? "marker" : type === GeometryType.Line ? "line" : type === GeometryType.Polygon ? "fill" : null;
}

export function readRenderer(id: string): RendererState {
  const r = rendererEl(id);
  const symbols = r ? [...r.querySelectorAll(":scope > symbols > symbol")] : [];
  const byName = (n: string | null) => symbols.find((s) => s.getAttribute("name") === n) ?? null;
  const base = (r && (findChild(r, "source-symbol")?.querySelector("symbol") ?? byName("0"))) || null;
  const color = (n: string | null) => {
    const s = byName(n);
    return s ? readSymbol(s).color : "#999999";
  };
  return {
    type: r?.getAttribute("type") ?? "none",
    base,
    attr: r?.getAttribute("attr") ?? "",
    categories: r
      ? [...r.querySelectorAll(":scope > categories > category")].map((c) => ({
          value: c.getAttribute("value") ?? "",
          label: c.getAttribute("label") ?? "",
          color: color(c.getAttribute("symbol")),
          render: c.getAttribute("render") !== "false",
        }))
      : [],
    ranges: r
      ? [...r.querySelectorAll(":scope > ranges > range")].map((c) => ({
          lower: Number(c.getAttribute("lower")),
          upper: Number(c.getAttribute("upper")),
          label: c.getAttribute("label") ?? "",
          color: color(c.getAttribute("symbol")),
          render: c.getAttribute("render") !== "false",
        }))
      : [],
    ramp: r?.getAttribute("qgisweb_ramp") ?? "",
    mode: findChild(r ?? layerEl(id), "classificationMethod")?.getAttribute("id") ?? "EqualInterval",
  };
}

function newRenderer(type: RendererType, attrs: Record<string, string> = {}) {
  const r = project().xml.createElement("renderer-v2");
  for (const [k, v] of Object.entries({ type, symbollevels: "0", enableorderby: "0", forceraster: "0", referencescale: "-1", ...attrs })) r.setAttribute(k, v);
  return r;
}

function replaceRenderer(id: string, r: Element) {
  const old = rendererEl(id);
  if (old) old.replaceWith(r);
  else layerEl(id).appendChild(r);
}

/** The symbol new classes start from: the current base symbol, or QGIS's default for the geometry. */
export function baseSymbol(id: string) {
  const { base } = readRenderer(id);
  const kind = symbolKind(id) ?? "fill";
  return base && base.getAttribute("type") === kind ? base : templateSymbol(kind);
}

export function setSingle(id: string, base = baseSymbol(id)) {
  const r = newRenderer("singleSymbol");
  child(r, "symbols").appendChild(cloneSymbol(base, "0"));
  replaceRenderer(id, r);
}

export function setCategorized(id: string, attr: string, cats: Category[], ramp: string) {
  const base = baseSymbol(id);
  const r = newRenderer("categorizedSymbol", { attr, qgisweb_ramp: ramp });
  const categories = child(r, "categories");
  const symbols = child(r, "symbols");
  cats.forEach((c, i) => {
    const el = project().xml.createElement("category");
    for (const [k, v] of Object.entries({ value: c.value, label: c.label, symbol: String(i), render: String(c.render), type: "string", uuid: uuid() })) el.setAttribute(k, v);
    categories.appendChild(el);
    symbols.appendChild(cloneSymbol(base, String(i), c.color));
  });
  child(r, "source-symbol").appendChild(cloneSymbol(base, "0"));
  replaceRenderer(id, r);
}

export function setGraduated(id: string, attr: string, ranges: Range[], ramp: string, mode: string) {
  const base = baseSymbol(id);
  const r = newRenderer("graduatedSymbol", { attr, graduatedMethod: "GraduatedColor", qgisweb_ramp: ramp });
  const rangesEl = child(r, "ranges");
  const symbols = child(r, "symbols");
  ranges.forEach((g, i) => {
    const el = project().xml.createElement("range");
    for (const [k, v] of Object.entries({ lower: String(g.lower), upper: String(g.upper), label: g.label, symbol: String(i), render: String(g.render), uuid: uuid() })) el.setAttribute(k, v);
    rangesEl.appendChild(el);
    symbols.appendChild(cloneSymbol(base, String(i), g.color));
  });
  child(r, "source-symbol").appendChild(cloneSymbol(base, "0"));
  child(r, "classificationMethod").setAttribute("id", mode);
  replaceRenderer(id, r);
}

/** Changes a property on every symbol of the renderer (e.g. stroke for all categories). */
export function setAllSymbols(id: string, p: Partial<SymbolProps>) {
  rendererEl(id)?.querySelectorAll("symbol").forEach((s) => s.parentElement?.closest("symbol") || writeSymbol(s, p));
}

export function setClassColor(id: string, index: number, color: string) {
  const r = rendererEl(id)!;
  const cls = [...r.querySelectorAll(":scope > categories > category, :scope > ranges > range")][index];
  const sym = r.querySelector(`:scope > symbols > symbol[name="${cls.getAttribute("symbol")}"]`);
  if (sym) writeSymbol(sym, { color });
}

/** Moves the break between class `index` and the next one (manual classification). */
export function setBreak(id: string, index: number, value: number) {
  const r = rendererEl(id)!;
  const ranges = [...r.querySelectorAll(":scope > ranges > range")];
  const relabel = (el: Element) => el.setAttribute("label", `${fmt(Number(el.getAttribute("lower")))} – ${fmt(Number(el.getAttribute("upper")))}`);
  ranges[index].setAttribute("upper", String(value));
  relabel(ranges[index]);
  if (ranges[index + 1]) {
    ranges[index + 1].setAttribute("lower", String(value));
    relabel(ranges[index + 1]);
  }
  child(r, "classificationMethod").setAttribute("id", "Custom");
}

export function setClassAttr(id: string, index: number, attr: string, value: string) {
  const r = rendererEl(id)!;
  [...r.querySelectorAll(":scope > categories > category, :scope > ranges > range")][index]?.setAttribute(attr, value);
}

// ---- Scale-dependent visibility ------------------------------------------------------------

/** QGIS's scale range: `minScale` is the most zoomed-out scale shown, `maxScale` the most zoomed-in (0 = no limit). */
export function readScaleRange(id: string) {
  const el = layerEl(id);
  return { enabled: el.getAttribute("hasScaleBasedVisibilityFlag") === "1", minScale: Number(el.getAttribute("minScale") ?? 0) || 0, maxScale: Number(el.getAttribute("maxScale") ?? 0) || 0 };
}

export function writeScaleRange(id: string, r: { enabled: boolean; minScale: number; maxScale: number }) {
  const el = layerEl(id);
  el.setAttribute("hasScaleBasedVisibilityFlag", r.enabled ? "1" : "0");
  el.setAttribute("minScale", String(r.minScale));
  el.setAttribute("maxScale", String(r.maxScale));
}

// ---- Classification --------------------------------------------------------------------

/** Values of a field (or expression) over all features, read from QGIS. */
export function fieldValues(id: string, attr: string): unknown[] {
  const api = engine();
  const layer = findMapLayer(id) as QgsVectorLayer;
  const req = new api.QgsFeatureRequest();
  req.setFlags(FeatureRequestFlag.NoGeometry);
  const fieldIdx = (() => {
    const fields = layer.fields();
    for (let i = 0; i < fields.count(); i++) if (fields.at(i).name() === attr) return i;
    return -1;
  })();
  const expr = fieldIdx < 0 ? new api.QgsExpression(attr) : null;
  const ctx = expr ? layer.createExpressionContext() : null;
  const out: unknown[] = [];
  const it = layer.getFeatures(req);
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    if (expr && ctx) {
      ctx.setFeature(f);
      out.push(expr.evaluate(ctx));
    } else out.push(f.attribute(fieldIdx));
    free(f);
  }
  free(it);
  free(req);
  free(expr);
  free(ctx);
  return out;
}

export function uniqueCategories(id: string, attr: string, ramp: string): Category[] {
  const values = [...new Set(fieldValues(id, attr).map((v) => (v === null ? "" : String(v))))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const colors = rampColors(ramp, values.length);
  return values.slice(0, 500).map((v, i) => ({ value: v, label: v === "" ? "(NULL)" : v, color: colors[i], render: true }));
}

export const MODES: Record<string, string> = {
  EqualInterval: "Equal interval",
  Quantile: "Equal count (quantile)",
  Jenks: "Natural breaks (Jenks)",
  Pretty: "Pretty breaks",
  StdDev: "Standard deviation",
  Custom: "Manual (edit the breaks below)",
};

function jenks(data: number[], k: number) {
  // Fisher–Jenks on a sample, like QGIS (which samples at most 3000 values).
  const step = Math.max(1, Math.floor(data.length / 3000));
  const d = data.filter((_, i) => i % step === 0);
  const n = d.length;
  const lower = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const variance = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) (lower[1][j] = 1), (variance[1][j] = 0);
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0, v = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = d[i3 - 1];
      s2 += val * val;
      s1 += val;
      w++;
      v = s2 - (s1 * s1) / w;
      if (i3 > 1) for (let j = 2; j <= k; j++) if (variance[l][j] >= v + variance[i3 - 1][j - 1]) (lower[l][j] = i3), (variance[l][j] = v + variance[i3 - 1][j - 1]);
    }
    lower[l][1] = 1;
    variance[l][1] = v;
  }
  const breaks = new Array(k);
  breaks[k - 1] = d[n - 1];
  for (let j = k, l = n; j >= 2; j--) {
    const id = lower[l][j] - 2;
    breaks[j - 2] = d[id];
    l = lower[l][j] - 1;
  }
  return breaks;
}

/** QGIS's pretty breaks (QgsSymbolLayerUtils::prettyBreaks, a port of R's pretty). */
export function pretty(min: number, max: number, classes: number) {
  if (classes < 1) return [max];
  const minimumCount = Math.trunc(classes / 3);
  const h = 1.5, adjustBias = 0.5 + 1.5 * h;
  const dx = max - min;
  let cell: number, small: boolean;
  if (Math.abs(dx) < 1e-12 && Math.abs(max) < 1e-12) (cell = 1), (small = true);
  else {
    cell = Math.max(Math.abs(min), Math.abs(max));
    const U = Math.trunc(1 + 1 / (1 + h));
    small = dx < cell * U * Math.max(1, classes) * 1e-7 * 3;
  }
  if (small) {
    if (cell > 10) cell = (9 + cell / 10) * 0.75;
    if (minimumCount > 1) cell /= minimumCount;
  } else if (classes > 1) cell = dx / classes;
  else cell = dx;
  cell = Math.max(cell, 20e-7);
  const base = 10 ** Math.floor(Math.log10(cell));
  let unit = base;
  if (2 * base - cell < h * (cell - unit)) {
    unit = 2 * base;
    if (5 * base - cell < adjustBias * (cell - unit)) {
      unit = 5 * base;
      if (10 * base - cell < h * (cell - unit)) unit = 10 * base;
    }
  }
  let start = Math.floor(min / unit + 1e-7), end = Math.ceil(max / unit - 1e-7);
  while (start * unit > min + 1e-7 * unit) start--;
  while (end * unit < max - 1e-7 * unit) end++;
  let k = Math.floor(0.5 + end - start);
  if (k < minimumCount) {
    k = minimumCount - k;
    const half = Math.trunc(k / 2);
    if (start >= 0) (end += half), (start = start - half + (k % 2));
    else (start -= half), (end = end + half + (k % 2));
  }
  const breaks = Array.from({ length: end - start }, (_, i) => start * unit + (i + 1) * unit);
  if (!breaks.length) return breaks;
  if (breaks[0] < min) breaks[0] = min;
  if (breaks[breaks.length - 1] > max) breaks[breaks.length - 1] = max;
  if (min < 0 && max > 0) {
    let pos = 0;
    for (let i = 1; i < breaks.length; i++) if (Math.abs(breaks[i]) < Math.abs(breaks[i - 1])) pos = i;
    breaks[pos] = 0;
  }
  return breaks;
}

/** QgsClassificationMethod::makeBreaksSymmetric, as the standard deviation method uses it. */
function symmetric(breaks: number[], point: number) {
  if (breaks.length < 2) return breaks;
  breaks.sort((a, b) => a - b);
  const absMin = Math.min(Math.abs(breaks[breaks.length - 2] - point), Math.abs(breaks[0] - point));
  const tolerance = Math.abs(breaks[0] - breaks[1]) / 100;
  for (let i = 0; i <= breaks.length - 2; i++) if (Math.abs(breaks[i] - point) >= absMin - tolerance) breaks.splice(i--, 1);
  return breaks;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : String(+v.toPrecision(4)));

export function classify(id: string, attr: string, mode: string, n: number, ramp: string): Range[] {
  const values = fieldValues(id, attr).map(Number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!values.length) return [];
  const min = values[0], max = values[values.length - 1];
  let uppers: number[];
  if (mode === "Quantile") uppers = Array.from({ length: n }, (_, i) => values[Math.min(values.length - 1, Math.ceil(((i + 1) * values.length) / n) - 1)]);
  else if (mode === "Jenks") uppers = jenks(values, Math.min(n, values.length));
  else if (mode === "Pretty") uppers = pretty(min, max, n);
  else if (mode === "StdDev") {
    // As QGIS: pretty breaks in standard deviations around the mean.
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    uppers = symmetric(pretty((min - mean) / sd, (max - mean) / sd, n), 0).map((z) => mean + z * sd);
  }
  else uppers = Array.from({ length: n }, (_, i) => min + ((max - min) * (i + 1)) / n);
  uppers = [...new Set(uppers)];
  const colors = rampColors(ramp, uppers.length);
  return uppers.map((upper, i) => {
    const lower = i === 0 ? min : uppers[i - 1];
    return { lower, upper, label: `${fmt(lower)} – ${fmt(upper)}`, color: colors[i], render: true };
  });
}

// ---- Labels ----------------------------------------------------------------------------

export interface LabelProps {
  enabled: boolean;
  simple: boolean;
  field: string;
  isExpression: boolean;
  font: string;
  size: number;
  color: string;
  buffer: boolean;
  bufferSize: number;
  bufferColor: string;
  placement: number;
}

const labelingEl = (id: string) => findChild(layerEl(id), "labeling");

export function readLabels(id: string): LabelProps {
  const l = labelingEl(id);
  const simple = !l || l.getAttribute("type") === "simple";
  const text = l?.querySelector("settings > text-style");
  const buf = text?.querySelector("text-buffer");
  return {
    enabled: layerEl(id).getAttribute("labelsEnabled") === "1" && !!l,
    simple,
    field: text?.getAttribute("fieldName") ?? "",
    isExpression: text?.getAttribute("isExpression") === "1",
    font: text?.getAttribute("fontFamily") ?? "Open Sans",
    size: Number(text?.getAttribute("fontSize") ?? 9),
    color: toHex(text?.getAttribute("textColor") ?? "0,0,0,255"),
    buffer: buf?.getAttribute("bufferDraw") === "1",
    bufferSize: Number(buf?.getAttribute("bufferSize") ?? 0.8),
    bufferColor: toHex(buf?.getAttribute("bufferColor") ?? "255,255,255,255"),
    placement: Number(l?.querySelector("settings > placement")?.getAttribute("placement") ?? 0),
  };
}

export function writeLabels(id: string, p: LabelProps) {
  const el = layerEl(id);
  let l = labelingEl(id);
  if (!l || l.getAttribute("type") !== "simple") {
    const t = project().xml.importNode(templates.querySelector("templates > labeling")!, true) as Element;
    if (l) l.replaceWith(t);
    else el.appendChild(t);
    l = t;
  }
  el.setAttribute("labelsEnabled", p.enabled ? "1" : "0");
  const text = l.querySelector("settings > text-style")!;
  text.setAttribute("fieldName", p.field);
  text.setAttribute("isExpression", p.isExpression ? "1" : "0");
  text.setAttribute("fontFamily", p.font);
  text.setAttribute("fontSize", String(p.size));
  text.setAttribute("textColor", toQgis(p.color));
  const buf = text.querySelector("text-buffer")!;
  buf.setAttribute("bufferDraw", p.buffer ? "1" : "0");
  buf.setAttribute("bufferSize", String(p.bufferSize));
  buf.setAttribute("bufferColor", toQgis(p.bufferColor));
  l.querySelector("settings > placement")!.setAttribute("placement", String(p.placement));
}

/** Qgis::LabelPlacement values that make sense per geometry. */
export const PLACEMENTS: Record<SymbolKind, [number, string][]> = {
  marker: [[6, "Cartographic"], [0, "Around point"], [1, "Offset from point"]],
  line: [[2, "Parallel"], [3, "Curved"], [4, "Horizontal"]],
  fill: [[0, "Around centroid"], [1, "Offset from centroid"], [4, "Horizontal"], [5, "Free (angled)"], [7, "Using perimeter (curved)"], [8, "Outside polygons"]],
};

// ---- QML -------------------------------------------------------------------------------

/** <maplayer> children that describe the data rather than the style; never part of a QML. */
const NOT_STYLE = new Set([
  "id", "datasource", "keywordList", "layername", "srs", "resourceMetadata", "provider", "extent", "wgs84extent",
  "vectorjoins", "layerDependencies", "dataDependencies", "auxiliaryLayer", "map-layer-style-manager", "noData",
]);
const STYLE_ATTRS = ["hasScaleBasedVisibilityFlag", "maxScale", "minScale", "labelsEnabled", "simplifyAlgorithm", "simplifyDrawingHints", "simplifyDrawingTol", "simplifyLocal", "simplifyMaxScale", "symbologyReferenceScale", "readOnly"];

export function exportQml(id: string): string {
  const el = layerEl(id);
  const qml = document.implementation.createDocument(null, "qgis", null);
  const root = qml.documentElement;
  root.setAttribute("version", "4.2.3-QGIS Web");
  root.setAttribute("styleCategories", "AllStyleCategories");
  for (const a of STYLE_ATTRS) if (el.hasAttribute(a)) root.setAttribute(a, el.getAttribute(a)!);
  for (const c of el.children) if (!NOT_STYLE.has(c.tagName)) root.appendChild(qml.importNode(c, true));
  return "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n" + new XMLSerializer().serializeToString(qml);
}

/** Applies a QML (Desktop-made or exported here): every style element it contains replaces the layer's. */
export function importQml(id: string, text: string) {
  const qml = new DOMParser().parseFromString(text, "application/xml");
  const root = qml.querySelector("qgis");
  if (!root || qml.querySelector("parsererror")) throw new Error("Not a QGIS style (.qml) file");
  const el = layerEl(id);
  for (const a of STYLE_ATTRS) if (root.hasAttribute(a)) el.setAttribute(a, root.getAttribute(a)!);
  for (const c of [...root.children]) {
    if (NOT_STYLE.has(c.tagName)) continue;
    const imported = project().xml.importNode(c, true);
    const existing = findChild(el, c.tagName);
    if (existing) existing.replaceWith(imported);
    else el.appendChild(imported);
  }
}

// ---- Popups (QGIS display name and map tip) -------------------------------------------------

export function readPopup(id: string) {
  const el = layerEl(id);
  return { display: findChild(el, "previewExpression")?.textContent ?? "", mapTip: findChild(el, "mapTip")?.textContent ?? "" };
}

export function writePopup(id: string, p: { display: string; mapTip: string }) {
  const el = layerEl(id);
  child(el, "previewExpression").textContent = p.display;
  const tip = child(el, "mapTip");
  tip.setAttribute("enabled", "1");
  tip.textContent = p.mapTip;
}

/** A starting map tip: every field as a small table, with QGIS [% %] placeholders. */
export const defaultMapTip = (fields: string[]) =>
  `<table>\n${fields.map((f) => `  <tr><th align="left">${f}</th><td>[% "${f.replaceAll('"', '""')}" %]</td></tr>`).join("\n")}\n</table>`;

// ---- Rule-based, heatmap and point cluster renderers ----------------------------------------

const rendererTemplates = new DOMParser().parseFromString(renderersXml, "application/xml");
const rendererTemplate = (type: string) => project().xml.importNode(rendererTemplates.querySelector(`templates > renderer-v2[type="${type}"]`)!, true) as Element;

export interface Rule { label: string; filter: string; color: string; minScale: number; maxScale: number; enabled: boolean; nested: boolean }

const ruleEls = (id: string) => [...(rendererEl(id)?.querySelectorAll(":scope > rules > rule") ?? [])];

export function readRules(id: string): Rule[] {
  const r = rendererEl(id)!;
  return ruleEls(id).map((el) => {
    const sym = r.querySelector(`:scope > symbols > symbol[name="${el.getAttribute("symbol")}"]`);
    return {
      label: el.getAttribute("label") ?? "",
      filter: el.getAttribute("filter") ?? "",
      color: sym ? readSymbol(sym).color : "#999999",
      // QGIS: scalemaxdenom is the most zoomed-out scale shown, scalemindenom the most zoomed-in.
      minScale: Number(el.getAttribute("scalemaxdenom") ?? 0),
      maxScale: Number(el.getAttribute("scalemindenom") ?? 0),
      enabled: el.getAttribute("checkstate") !== "0",
      nested: el.querySelector(":scope > rule") !== null,
    };
  });
}

const quoteValue = (v: string) => (v !== "" && !Number.isNaN(Number(v)) ? v : `'${v.replaceAll("'", "''")}'`);
/** A field name as an expression; an attribute that is already an expression is kept as is. */
const quoteField = (f: string) => (/^"[^"]*"$/.test(f) || /[()+\-*/|]/.test(f) ? f : `"${f}"`);

/** Converts the current renderer to rules (each category or class becomes a rule), as QGIS does. */
export function setRuleBased(id: string) {
  const cur = readRenderer(id);
  const r = rendererTemplate("RuleRenderer");
  const rules = r.querySelector(":scope > rules")!;
  rules.setAttribute("key", uuid());
  rules.replaceChildren();
  const symbols = child(r, "symbols");
  symbols.replaceChildren();
  const add = (label: string, filter: string, sym: Element) => {
    const name = String(rules.children.length);
    const el = project().xml.createElement("rule");
    for (const [k, v] of Object.entries({ key: uuid(), label, filter, symbol: name })) el.setAttribute(k, v);
    rules.appendChild(el);
    symbols.appendChild(cloneSymbol(sym, name));
  };
  const old = rendererEl(id);
  const symOf = (n: string | null) => old?.querySelector(`:scope > symbols > symbol[name="${n}"]`) ?? baseSymbol(id);
  const field = quoteField(cur.attr);
  if (cur.type === "categorizedSymbol") old!.querySelectorAll(":scope > categories > category").forEach((c) => add(c.getAttribute("label") ?? "", c.getAttribute("value") === "" ? "ELSE" : `${field} = ${quoteValue(c.getAttribute("value") ?? "")}`, symOf(c.getAttribute("symbol"))));
  else if (cur.type === "graduatedSymbol") old!.querySelectorAll(":scope > ranges > range").forEach((c) => add(c.getAttribute("label") ?? "", `${field} >= ${c.getAttribute("lower")} AND ${field} <= ${c.getAttribute("upper")}`, symOf(c.getAttribute("symbol"))));
  else add("All features", "", baseSymbol(id));
  replaceRenderer(id, r);
}

export function setRule(id: string, index: number, p: Partial<Rule>) {
  const el = ruleEls(id)[index];
  if (!el) return;
  if (p.label !== undefined) el.setAttribute("label", p.label);
  if (p.filter !== undefined) p.filter ? el.setAttribute("filter", p.filter) : el.removeAttribute("filter");
  if (p.minScale !== undefined) p.minScale ? el.setAttribute("scalemaxdenom", String(p.minScale)) : el.removeAttribute("scalemaxdenom");
  if (p.maxScale !== undefined) p.maxScale ? el.setAttribute("scalemindenom", String(p.maxScale)) : el.removeAttribute("scalemindenom");
  if (p.enabled !== undefined) p.enabled ? el.removeAttribute("checkstate") : el.setAttribute("checkstate", "0");
  if (p.color) {
    const sym = rendererEl(id)!.querySelector(`:scope > symbols > symbol[name="${el.getAttribute("symbol")}"]`);
    if (sym) writeSymbol(sym, { color: p.color });
  }
}

export function addRule(id: string) {
  const r = rendererEl(id)!;
  const names = [...r.querySelectorAll(":scope > symbols > symbol")].map((s) => Number(s.getAttribute("name"))).filter(Number.isFinite);
  const name = String(names.length ? Math.max(...names) + 1 : 0);
  const el = project().xml.createElement("rule");
  for (const [k, v] of Object.entries({ key: uuid(), label: "New rule", filter: "TRUE", symbol: name })) el.setAttribute(k, v);
  r.querySelector(":scope > rules")!.appendChild(el);
  child(r, "symbols").appendChild(cloneSymbol(baseSymbol(id), name, rampColors("Bold", names.length + 1).at(-1)));
}

export function removeRule(id: string, index: number) {
  const el = ruleEls(id)[index];
  if (!el) return;
  rendererEl(id)!.querySelector(`:scope > symbols > symbol[name="${el.getAttribute("symbol")}"]`)?.remove();
  el.remove();
}

export interface Heatmap { radius: number; ramp: string; weight: string; maxValue: number }

export function readHeatmap(id: string): Heatmap {
  const r = rendererEl(id)!;
  return { radius: Number(r.getAttribute("radius") ?? 10), ramp: r.getAttribute("qgisweb_ramp") ?? "YlOrRd", weight: r.getAttribute("weight_expression") ?? "", maxValue: Number(r.getAttribute("max_value") ?? 0) };
}

/** A QGIS gradient color ramp (transparent at the low end, so sparse areas fade out). */
function writeGradient(ramp: Element, name: string) {
  const stops = rampColors(name, 6);
  const opt = (k: string, v: string) => {
    let o = ramp.querySelector(`:scope > Option > Option[name="${k}"]`);
    if (!o) {
      o = ramp.ownerDocument.createElement("Option");
      o.setAttribute("name", k);
      o.setAttribute("type", "QString");
      ramp.querySelector(":scope > Option")!.appendChild(o);
    }
    o.setAttribute("value", v);
  };
  opt("color1", toQgis(stops[0], 0));
  opt("color2", toQgis(stops.at(-1)!));
  opt("stops", stops.slice(1, -1).map((c, i) => `${((i + 1) / (stops.length - 1)).toFixed(3)};${toQgis(c)}`).join(":"));
}

export function setHeatmap(id: string, h: Partial<Heatmap> = {}) {
  const cur = rendererEl(id)?.getAttribute("type") === "heatmapRenderer" ? readHeatmap(id) : { radius: 10, ramp: "YlOrRd", weight: "", maxValue: 0 };
  const next = { ...cur, ...h };
  const r = rendererTemplate("heatmapRenderer");
  r.setAttribute("radius", String(next.radius));
  r.setAttribute("radius_unit", "0");
  r.setAttribute("weight_expression", next.weight);
  r.setAttribute("max_value", String(next.maxValue));
  r.setAttribute("qgisweb_ramp", next.ramp);
  writeGradient(r.querySelector(":scope > colorramp")!, next.ramp);
  replaceRenderer(id, r);
}

/** Point clusters: nearby points are drawn as one counted symbol; the current renderer draws the rest. */
export function setCluster(id: string, tolerance = 3) {
  const old = rendererEl(id);
  const r = rendererTemplate("pointCluster");
  r.setAttribute("tolerance", String(tolerance));
  const embedded = r.querySelector(":scope > renderer-v2");
  const inner = old && !["pointCluster", "heatmapRenderer"].includes(old.getAttribute("type") ?? "") ? (old.cloneNode(true) as Element) : null;
  if (embedded && inner) embedded.replaceWith(inner);
  replaceRenderer(id, r);
}

export const clusterTolerance = (id: string) => Number(rendererEl(id)?.getAttribute("tolerance") ?? 3);
