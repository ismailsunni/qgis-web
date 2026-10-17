import { child, findChild, mapLayerEl } from "./doc";

/** QGIS vector joins (Layer Properties › Joins), stored in the project; QGIS itself joins the attributes. */
export interface Join { layer: string; joinField: string; targetField: string; prefix: string; fields: string[] | null }

export function readJoins(id: string): Join[] {
  const el = findChild(mapLayerEl(id)!, "vectorjoins");
  return [...(el?.querySelectorAll(":scope > join") ?? [])].map((j) => ({
    layer: j.getAttribute("joinLayerId") ?? "",
    joinField: j.getAttribute("joinFieldName") ?? "",
    targetField: j.getAttribute("targetFieldName") ?? "",
    prefix: j.getAttribute("hasCustomPrefix") === "1" ? (j.getAttribute("customPrefix") ?? "") : "",
    fields: j.querySelector(":scope > joinFieldsSubset") ? [...j.querySelectorAll(":scope > joinFieldsSubset > field")].map((f) => f.getAttribute("name")!) : null,
  }));
}

export function writeJoins(id: string, joins: Join[]) {
  const el = child(mapLayerEl(id)!, "vectorjoins");
  el.replaceChildren();
  for (const j of joins) {
    const e = el.ownerDocument.createElement("join");
    const attrs = { cascadedDelete: "0", customPrefix: j.prefix, dynamicForm: "0", editable: "0", hasCustomPrefix: "1", joinFieldName: j.joinField, joinLayerId: j.layer, memoryCache: "1", targetFieldName: j.targetField, upsertOnEdit: "0" };
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (j.fields) {
      const subset = e.appendChild(el.ownerDocument.createElement("joinFieldsSubset"));
      for (const f of j.fields) subset.appendChild(el.ownerDocument.createElement("field")).setAttribute("name", f);
    }
    el.appendChild(e);
  }
}
