/** Svelte action for menus: closes on a click anywhere else, or Escape. `keep` is the menu's own toggle button. */
export function dismiss(node: HTMLElement, opts: { close: () => void; keep?: HTMLElement | null }) {
  const down = (e: PointerEvent) => !node.contains(e.target as Node) && !opts.keep?.contains(e.target as Node) && opts.close();
  const key = (e: KeyboardEvent) => e.key === "Escape" && opts.close();
  addEventListener("pointerdown", down, true);
  addEventListener("keydown", key);
  return {
    update: (o: typeof opts) => void (opts = o),
    destroy() {
      removeEventListener("pointerdown", down, true);
      removeEventListener("keydown", key);
    },
  };
}
