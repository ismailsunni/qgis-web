import { expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

/** Opens the app and waits for the QGIS engine to boot. */
export async function boot(page: Page, query = "") {
  await page.goto(query);
  await page.waitForFunction(() => (globalThis as any).qgisWebApp?.ui.phase && (globalThis as any).qgisWebApp.ui.phase !== "booting", null, { timeout: 150_000 });
}

/** Opens a project by URL (relative to the site) and waits until it is ready. */
export async function openProject(page: Page, url: string) {
  await page.evaluate((u) => (globalThis as any).qgisWebApp.actions.openUrl(u), url);
  await expect.poll(() => page.evaluate(() => (globalThis as any).qgisWebApp.ui.phase)).toBe("ready");
}

export const layers = (page: Page) =>
  page.evaluate(() => {
    const { tree } = (globalThis as any).qgisWebApp;
    return tree.flatLayers(tree.snapshotTree()).map((l: any) => ({ name: l.name, valid: l.valid, visible: l.visible, id: l.layerId }));
  });

/** Renders the open project with QGIS for an extent, composited on white, as a PNG. */
export async function render(page: Page, extent: number[], width: number, height: number) {
  const b64 = await page.evaluate(
    async ({ extent, width, height }) => {
      const api = (globalThis as any).qgisWeb.api;
      const rect = new api.QgsRectangle(extent[0], extent[1], extent[2], extent[3]);
      const img: ImageData = await api.renderImage(api.srid(), rect, width, height, 1);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(await createImageBitmap(img), 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    },
    { extent, width, height },
  );
  return PNG.sync.read(Buffer.from(b64, "base64"));
}
