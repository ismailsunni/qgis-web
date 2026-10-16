import type { QgsVectorLayer } from "qgis-js";
import { child, findChild, hooks, layerIds, layerSource, mapLayerEl } from "./doc";
import { findMapLayer } from "./engine";
import { redraw } from "./map";
import { fieldValues } from "./style";
import { ui } from "./state.svelte";

/**
 * QGIS's temporal controller: layers with time-based properties (<temporal> in the project) show
 * only the features of the current time range. The range is applied as a provider filter.
 */

export interface Temporal { enabled: boolean; mode: 1 | 2; start: string; end: string; accumulate: boolean }
export const UNITS = { hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3, months: 0, years: 0 } as const;
export type Unit = keyof typeof UNITS;

/** QGIS's vector temporal modes handled here: 1 = instant from a field, 2 = start and end fields. */
export function readTemporal(id: string): Temporal {
  const t = findChild(mapLayerEl(id)!, "temporal");
  const mode = Number(t?.getAttribute("mode") ?? 1);
  return { enabled: t?.getAttribute("enabled") === "1" && (mode === 1 || mode === 2), mode: mode === 2 ? 2 : 1, start: t?.getAttribute("startField") ?? "", end: t?.getAttribute("endField") ?? "", accumulate: t?.getAttribute("accumulate") === "1" };
}

export function writeTemporal(id: string, p: Temporal) {
  const t = child(mapLayerEl(id)!, "temporal");
  const attrs = { enabled: p.enabled ? "1" : "0", mode: String(p.mode), limitMode: "0", startField: p.start, endField: p.mode === 2 ? p.end : "", accumulate: p.accumulate ? "1" : "0", startExpression: "", endExpression: "", durationField: "", durationUnit: "min", fixedDuration: "0" };
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  const range = child(t, "fixedRange");
  child(range, "start");
  child(range, "end");
}

export const temporalLayers = () => layerIds().filter((id) => findMapLayer(id) && readTemporal(id).enabled);

/** Times without a zone are read as UTC, the same as the filter literals. */
const parseTime = (s: string) => Date.parse(/T[^Z+]*$/.test(s) && !/[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s);

/** The start of the unit containing the time (frames start on whole days, months…). */
export function floorTo(ms: number, unit: Unit) {
  const d = new Date(ms);
  if (unit !== "hours") d.setUTCHours(0, 0, 0, 0);
  else d.setUTCMinutes(0, 0, 0);
  if (unit === "weeks") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (unit === "months" || unit === "years") d.setUTCDate(1);
  if (unit === "years") d.setUTCMonth(0);
  return d.getTime();
}

/** First and last time over the temporal layers' fields. */
export function timeExtent(): [number, number] | null {
  let min = Infinity, max = -Infinity;
  for (const id of temporalLayers()) {
    const t = readTemporal(id);
    for (const f of t.mode === 2 ? [t.start, t.end] : [t.start])
      for (const v of fieldValues(id, f)) {
        const ms = parseTime(String(v));
        if (Number.isFinite(ms)) (min = Math.min(min, ms)), (max = Math.max(max, ms));
      }
  }
  return min <= max ? [min, max] : null;
}

export function addStep(ms: number, n: number, unit: Unit) {
  const d = new Date(ms);
  if (unit === "months") d.setUTCMonth(d.getUTCMonth() + n);
  else if (unit === "years") d.setUTCFullYear(d.getUTCFullYear() + n);
  else return ms + n * UNITS[unit];
  return d.getTime();
}

/** A step that gives a few dozen frames over the extent. */
export function defaultStep([a, b]: [number, number]): [number, Unit] {
  const span = b - a;
  return span > 3 * 365 * 864e5 ? [1, "years"] : span > 90 * 864e5 ? [1, "months"] : span > 21 * 864e5 ? [1, "weeks"] : span > 2 * 864e5 ? [1, "days"] : [1, "hours"];
}

const quote = (f: string) => `"${f.replaceAll('"', '""')}"`;

/** The provider filter for a time range: SQL for OGR sources, a QGIS expression otherwise. */
function filter(id: string, t: Temporal, [a, b]: [number, number]) {
  const layer = findMapLayer(id) as QgsVectorLayer;
  const sql = layerSource(id).provider === "ogr";
  const fields = layer.fields();
  const lit = (field: string, ms: number) => {
    const iso = new Date(ms).toISOString().slice(0, 19);
    const date = fields.field(field)?.type() === 14;
    const v = date ? iso.slice(0, 10) : iso;
    return sql ? `'${v}'` : `to_datetime('${v}')`;
  };
  const col = (f: string) => (sql ? quote(f) : `to_datetime(${quote(f)})`);
  const s = col(t.start);
  if (t.mode === 1) return t.accumulate ? `(${s} < ${lit(t.start, b)} OR ${quote(t.start)} IS NULL)` : `((${s} >= ${lit(t.start, a)} AND ${s} < ${lit(t.start, b)}) OR ${quote(t.start)} IS NULL)`;
  const e = col(t.end);
  return `((${s} < ${lit(t.start, b)} OR ${quote(t.start)} IS NULL) AND (${e} >= ${lit(t.end, a)} OR ${quote(t.end)} IS NULL))`;
}

const baseSubset = (id: string) => layerSource(id).datasource.match(/\|subset=(.*)$/)?.[1] ?? "";

/** Shows the features of the time range on the map (null: all features). */
export function applyTime(range: [number, number] | null, draw = true) {
  for (const id of layerIds()) {
    const layer = findMapLayer(id) as QgsVectorLayer | undefined;
    if (!layer?.setSubsetString) continue;
    const t = readTemporal(id);
    const base = baseSubset(id);
    const time = range && t.enabled && t.start ? filter(id, t, range) : "";
    const subset = base && time ? `(${base}) AND ${time}` : base || time;
    if (layer.subsetString() !== subset) layer.setSubsetString(subset);
  }
  if (draw) redraw();
}

// A reload recreates the layers from the project, without the time filter.
hooks.afterReload = () => ui.time.active && applyTime(ui.time.range, false);
