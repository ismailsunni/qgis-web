import { LayerType, type QgsLayerTreeNode, type QgsLayerTreeLayer } from "qgis-js";
import { engine } from "./engine";
import { child, mapLayerEl, removeLayerXml, treeChildren, treeEl, treeRootEl, project, isRemote, xmlOpacity } from "./doc";
import { apply } from "./commit";
import { snapshot } from "./history";
import { redraw } from "./map";
import { changed, ui, type IdentifyHit } from "./state.svelte";

export interface TreeNode {
  key: string;
  name: string;
  isGroup: boolean;
  checked: boolean;
  visible: boolean;
  expanded: boolean;
  layerId?: string;
  layerType?: LayerType;
  valid?: boolean;
  /** Read from the network by the browser rather than by QGIS (XYZ, WMS, COG…). */
  remote?: boolean;
  editing?: boolean;
  /** Number of selected features. */
  selected?: number;
  opacity?: number;
  children: TreeNode[];
  node: QgsLayerTreeNode;
}

/** A plain snapshot of the engine's layer tree; re-read after every change. */
export function snapshotTree(): TreeNode[] {
  const walk = (n: QgsLayerTreeNode, key: string, parentVisible: boolean): TreeNode => {
    const checked = n.itemVisibilityChecked;
    const base = { key, name: n.name, checked, visible: parentVisible && checked, expanded: n.expanded, node: n };
    if (n.isGroup()) {
      return { ...base, isGroup: true, children: n.children().map((c, i) => walk(c, `${key}/${i}`, base.visible)) };
    }
    const layer = (n as QgsLayerTreeLayer).layer();
    return {
      ...base,
      isGroup: false,
      layerId: (n as QgsLayerTreeLayer).layerId(),
      layerType: layer?.type(),
      valid: !!layer?.isValid(),
      remote: isRemote((n as QgsLayerTreeLayer).layerId()),
      editing: ui.editing === (n as QgsLayerTreeLayer).layerId(),
      selected: ui.selection[(n as QgsLayerTreeLayer).layerId()]?.length ?? 0,
      opacity: layer?.opacity ?? xmlOpacity((n as QgsLayerTreeLayer).layerId()),
      children: [],
    };
  };
  return engine().layerTreeRoot().children().map((c, i) => walk(c, `${i}`, true));
}

export const flatLayers = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((n) => (n.isGroup ? flatLayers(n.children) : [n]));

const checked = (on: boolean) => (on ? "Qt::Checked" : "Qt::Unchecked");

/** Visibility and expansion apply live in QGIS and are mirrored into the document (no reload). */
export function setVisible(n: TreeNode, on: boolean) {
  snapshot(`${on ? "show" : "hide"} ${n.name}`);
  n.node.itemVisibilityChecked = on;
  treeEl(n.key).setAttribute("checked", checked(on));
  ui.dirty = true;
  changed();
  redraw();
}

export function setExpanded(n: TreeNode, on: boolean) {
  n.node.expanded = on;
  treeEl(n.key).setAttribute("expanded", on ? "1" : "0");
  changed();
}

export function setOpacity(n: TreeNode, value: number) {
  snapshot(`opacity of ${n.name}`);
  const layer = (n.node as QgsLayerTreeLayer).layer();
  if (layer) layer.opacity = value;
  const el = mapLayerEl(n.layerId!)!;
  const renderer = el.querySelector("pipe > rasterrenderer");
  if (renderer) renderer.setAttribute("opacity", String(value));
  else child(el, "layerOpacity").textContent = String(value);
  ui.dirty = true;
  changed();
  redraw();
}

export function rename(n: TreeNode, name: string) {
  apply(() => {
    treeEl(n.key).setAttribute("name", name);
    if (!n.isGroup) child(mapLayerEl(n.layerId!)!, "layername").textContent = name;
  }, `rename ${n.name}`);
}

export function remove(n: TreeNode) {
  apply(() => {
    const el = treeEl(n.key);
    for (const l of [el, ...el.querySelectorAll("layer-tree-layer")]) if (l.tagName === "layer-tree-layer") removeLayerXml(l.getAttribute("id")!);
    el.remove();
  }, `remove ${n.name}`);
  if (ui.current === n.layerId) ui.current = null;
  if (ui.tableLayerId === n.layerId) ui.tableLayerId = null;
  ui.hits = ui.hits.filter((h: IdentifyHit) => h.layerId !== n.layerId);
}

export function addGroup(name = "New group") {
  apply(() => {
    const xml = project().xml;
    const g = xml.createElement("layer-tree-group");
    g.setAttribute("name", name);
    g.setAttribute("checked", "Qt::Checked");
    g.setAttribute("expanded", "1");
    const root = treeRootEl();
    root.insertBefore(g, treeChildren(root)[0] ?? root.firstChild);
  }, "add group");
}

/** Moves a node before/after another node, or into a group. */
export function move(fromKey: string, toKey: string, where: "before" | "after" | "into") {
  if (toKey === fromKey || toKey.startsWith(fromKey + "/")) return;
  apply(() => {
    const from = treeEl(fromKey);
    const to = treeEl(toKey);
    if (where === "into") to.insertBefore(from, treeChildren(to)[0] ?? null);
    else to.parentElement!.insertBefore(from, where === "before" ? to : to.nextSibling);
    // Rendering follows the tree unless the project uses a custom order.
    const order = treeRootEl().querySelector(":scope > custom-order");
    if (order?.getAttribute("enabled") === "1") {
      const ids = [...treeRootEl().querySelectorAll("layer-tree-layer")].map((e) => e.getAttribute("id")!);
      order.replaceChildren(...ids.map((id) => Object.assign(project().xml.createElement("item"), { textContent: id })));
    }
  }, "move layer");
}

