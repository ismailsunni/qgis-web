import { FeatureRequestFlag, type QgsVectorLayer } from "qgis-js";
import { mapLayerEl } from "./doc";
import { engine, findMapLayer, free } from "./engine";
import { t } from "./i18n";

/**
 * Attribute forms as configured in the project (QGIS's Attributes Form): widgets, aliases,
 * constraints and default values, honored when viewing and editing features.
 */

export interface FieldForm {
  name: string;
  alias: string;
  widget: string;
  config: Record<string, unknown>;
  /** Value map entries as [label, stored value]. */
  options: [string, string][];
  readOnly: boolean;
  hidden: boolean;
  notNull: number;
  unique: number;
  expression: string;
  expressionDesc: string;
  expressionStrength: number;
  defaultExpression: string;
  applyOnUpdate: boolean;
}

type OptionValue = string | number | boolean | null | OptionValue[] | { [k: string]: OptionValue };

/** Parses QGIS's <Option> trees (Map, List, typed values). */
function parseOption(el: Element | null): OptionValue {
  if (!el) return null;
  const type = el.getAttribute("type");
  const kids = [...el.children].filter((c) => c.tagName === "Option");
  if (type === "Map") return Object.fromEntries(kids.map((k) => [k.getAttribute("name") ?? "", parseOption(k)]));
  if (type === "List" || type === "StringList") return kids.map(parseOption);
  const v = el.getAttribute("value");
  if (v === null) return null;
  if (type === "bool") return v === "true";
  if (type === "int" || type === "double" || type === "uint" || type === "longlong") return Number(v);
  return v;
}

export function readForm(layerId: string): Map<string, FieldForm> {
  const el = mapLayerEl(layerId);
  const out = new Map<string, FieldForm>();
  if (!el) return out;
  const attr = (sel: string, field: string, name: string) => el.querySelector(`${sel}[field="${CSS.escape(field)}"]`)?.getAttribute(name) ?? "";
  for (const f of el.querySelectorAll(":scope > fieldConfiguration > field")) {
    const name = f.getAttribute("name") ?? "";
    const w = f.querySelector(":scope > editWidget");
    const config = (parseOption(w?.querySelector(":scope > config > Option") ?? null) ?? {}) as Record<string, OptionValue>;
    const map = config.map;
    const options: [string, string][] = Array.isArray(map)
      ? map.flatMap((m) => Object.entries((m ?? {}) as Record<string, OptionValue>).map(([k, v]) => [k, String(v)] as [string, string]))
      : map && typeof map === "object"
        ? Object.entries(map).map(([k, v]) => [k, String(v)] as [string, string])
        : [];

    out.set(name, {
      name,
      alias: attr(":scope > aliases > alias", name, "name"),
      widget: w?.getAttribute("type") ?? "",
      config,
      options,
      readOnly: el.querySelector(`:scope > editable > field[name="${CSS.escape(name)}"]`)?.getAttribute("editable") === "0",
      hidden: w?.getAttribute("type") === "Hidden",
      notNull: Number(attr(":scope > constraints > constraint", name, "notnull_strength") || 0) * (Number(attr(":scope > constraints > constraint", name, "constraints") || 0) & 1 ? 1 : 0),
      unique: Number(attr(":scope > constraints > constraint", name, "unique_strength") || 0) * (Number(attr(":scope > constraints > constraint", name, "constraints") || 0) & 2 ? 1 : 0),
      expression: attr(":scope > constraintExpressions > constraint", name, "exp"),
      expressionDesc: attr(":scope > constraintExpressions > constraint", name, "desc"),
      expressionStrength: Number(attr(":scope > constraints > constraint", name, "exp_strength") || 0),
      defaultExpression: attr(":scope > defaults > default", name, "expression"),
      applyOnUpdate: attr(":scope > defaults > default", name, "applyOnUpdate") === "1",
    });
  }
  return out;
}

/** How QGIS shows a value with its widget (value map labels, checkbox states, dates). */
export function displayValue(form: FieldForm | undefined, v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (form?.widget === "ValueMap") return form.options.find(([, val]) => val === String(v))?.[0] ?? String(v);
  if (form?.widget === "CheckBox") return String(v) === String(form.config.CheckedState ?? "1") || v === true ? "✓" : "✗";
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

/** Converts what a widget produced to the stored value. */
export function parseInput(form: FieldForm | undefined, text: string, old: unknown): unknown {
  if (text === "" && form?.widget !== "TextEdit") return null;
  if (form?.widget === "Range" || typeof old === "number") return Number.isNaN(Number(text)) ? text : Number(text);
  return text;
}

/**
 * Checks a new value against the field's constraints with QGIS: not null, unique, and the
 * constraint expression (evaluated on the feature with the new value). Hard failures block
 * the edit; soft ones only warn.
 */
export function validate(layerId: string, fid: number, form: FieldForm | undefined, value: unknown): { error?: string; warning?: string } {
  if (!form) return {};
  const problems: [number, string][] = [];
  if (form.notNull && (value === null || value === "")) problems.push([form.notNull, t("{field} can't be empty", { field: form.alias || form.name })]);
  const api = engine();
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  if (form.unique && value !== null) {
    const req = new api.QgsFeatureRequest();
    req.setFilterExpression(`"${form.name.replaceAll('"', '""')}" = ${typeof value === "number" ? value : `'${String(value).replaceAll("'", "''")}'`}`);
    req.setFlags(FeatureRequestFlag.NoGeometry);
    const it = layer.getFeatures(req);
    for (let f = it.nextFeature(); f; f = it.nextFeature()) {
      if (f.id() !== fid) problems.push([form.unique, t("{field} must be unique", { field: form.alias || form.name })]);
      free(f);
      if (problems.length) break;
    }
    free(it);
    free(req);
  }
  if (form.expression) {
    const req = new api.QgsFeatureRequest();
    req.setFilterFid(fid);
    const it = layer.getFeatures(req);
    const f = it.nextFeature();
    if (f) {
      f.setAttribute(form.name, value as never);
      const ctx = layer.createExpressionContext();
      ctx.setFeature(f);
      const e = new api.QgsExpression(form.expression);
      if (!e.evaluate(ctx)) problems.push([form.expressionStrength || 1, form.expressionDesc || t("Constraint not met: {expression}", { expression: form.expression })]);
      free(e);
      free(ctx);
      free(f);
    }
    free(it);
    free(req);
  }
  const hard = problems.find(([s]) => s === 1);
  const soft = problems.find(([s]) => s === 2);
  return { error: hard?.[1], warning: soft?.[1] };
}

/** Default values for a feature (new, or on update when `updating`), evaluated by QGIS. */
export function defaultValues(layerId: string, fid: number, updating = false): Record<string, unknown> {
  const forms = [...readForm(layerId).values()].filter((f) => f.defaultExpression && (!updating || f.applyOnUpdate));
  if (!forms.length) return {};
  const api = engine();
  const layer = findMapLayer(layerId) as QgsVectorLayer;
  const req = new api.QgsFeatureRequest();
  req.setFilterFid(fid);
  const it = layer.getFeatures(req);
  const f = it.nextFeature();
  const out: Record<string, unknown> = {};
  if (f) {
    const ctx = layer.createExpressionContext();
    ctx.setFeature(f);
    for (const form of forms) {
      const e = new api.QgsExpression(form.defaultExpression);
      out[form.name] = e.evaluate(ctx);
      free(e);
    }
    free(ctx);
    free(f);
  }
  free(it);
  free(req);
  return out;
}
