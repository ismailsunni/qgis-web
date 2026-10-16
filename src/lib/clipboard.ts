import { exportQml, importQml } from "./style";
import { apply } from "./commit";
import { findMapLayer } from "./engine";
import { toast } from "./state.svelte";

/** Copy/paste of layer styles, as QML (also put on the system clipboard, like QGIS does). */
let copied: { qml: string; from: string } | null = null;

export const hasCopiedStyle = () => !!copied;

export function copyStyle(layerId: string) {
  copied = { qml: exportQml(layerId), from: findMapLayer(layerId)?.name ?? "" };
  navigator.clipboard?.writeText(copied.qml).catch(() => {});
  toast(`Copied the style of ${copied.from}`);
}

export function pasteStyle(layerId: string) {
  if (!copied) return;
  const qml = copied.qml;
  apply(() => importQml(layerId, qml), "paste style");
}
