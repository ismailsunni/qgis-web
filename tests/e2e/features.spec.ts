import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { boot, layers } from "./helpers";

/** UI-level checks of the main features, on the demo project. */

async function demo(page: import("@playwright/test").Page, query = "") {
  await boot(page, query);
  if (!query.includes("url=")) await page.getByText("Try the demo").click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).qgisWebApp.ui.phase)).toBe("ready");
}

test("identify shows attributes from QGIS (F4)", async ({ page }) => {
  await demo(page);
  const box = (await page.locator(".map").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await expect(page.locator(".identify")).toContainText("CONTINENT");
});

test("attribute table filters with a QGIS expression (F6)", async ({ page }) => {
  await demo(page);
  await page.locator(".node", { hasText: "Countries" }).locator(".name").click();
  await page.locator('.rail-btn[aria-label="Attribute table"]').click();
  await expect(page.locator(".drawer h3")).toContainText("177 features");
  await page.locator(".drawer input").first().fill(`"CONTINENT" = 'Africa'`);
  await page.locator(".drawer button", { hasText: "Filter" }).click();
  await expect(page.locator(".drawer h3")).toContainText("51 features");
});

test("attribute table handles 100k features (F6)", async ({ page }) => {
  await demo(page);
  const ms = await page.evaluate(async () => {
    const app = (globalThis as any).qgisWebApp;
    const gpkg = app.gpkg.writeGpkgTable;
    const features = Array.from({ length: 100_000 }, (_, i) => {
      const b = new DataView(new ArrayBuffer(21));
      b.setUint8(0, 1);
      b.setUint32(1, 1, true);
      b.setFloat64(5, (i % 360) - 180, true);
      b.setFloat64(13, ((i / 360) % 170) - 85, true);
      return { geometry: new Uint8Array(b.buffer), attributes: [i, `name ${i}`] };
    });
    const bytes = await gpkg(null, { name: "big", geometryType: "POINT", srs: { organization: "EPSG", code: 4326, definition: "undefined" }, fields: [{ name: "n", type: "INTEGER" }, { name: "label", type: "TEXT" }], features });
    const [id] = await app.adddata.addData([{ path: "big.gpkg", data: bytes }]);
    const t0 = performance.now();
    app.ui.tableLayerId = id;
    return t0;
  });
  await expect(page.locator(".drawer h3")).toContainText("100,000 features", { timeout: 120_000 });
  const scroll = page.locator(".table-scroll");
  const t = Date.now();
  for (let i = 0; i < 20; i++) await scroll.evaluate((el, y) => (el.scrollTop = y), i * 140_000);
  expect(Date.now() - t).toBeLessThan(5000);
  expect(await page.locator(".table-scroll tbody tr").count()).toBeLessThan(80);
  expect(ms).toBeGreaterThan(0);
});

test("style editor switches to graduated and saves labels (F7, F8)", async ({ page }) => {
  await demo(page);
  await page.locator(".node", { hasText: "Countries" }).locator(".name").click();
  await page.locator('.rail-btn[aria-label="Style"]').click();
  await page.locator(".panel select").first().selectOption("graduatedSymbol");
  await expect(page.locator(".classes li")).toHaveCount(5);
  await page.locator(".panel label.row", { hasText: "Labels" }).locator("input").check();
  const r = await page.evaluate(() => {
    const { style, ui } = (globalThis as any).qgisWebApp;
    return [style.readRenderer(ui.current).type, style.readLabels(ui.current).enabled];
  });
  expect(r).toEqual(["graduatedSymbol", true]);
});

test("editing adds a feature and undo removes it (F13)", async ({ page }) => {
  await demo(page);
  const count = await page.evaluate(async () => {
    const { tree, editing, engine } = (globalThis as any).qgisWebApp;
    const id = tree.flatLayers(tree.snapshotTree()).find((l: any) => l.name === "Places").layerId;
    await editing.startEditing(id);
    const n = () => engine.findMapLayer(id).featureCount();
    const before = n();
    await editing.addFeature(new (globalThis as any).qgisWebApp.PointGeometry([0, 0]));
    const added = n();
    editing.undo();
    return [before, added, n()];
  });
  expect(count[1]).toBe(count[0] + 1);
  expect(count[2]).toBe(count[0]);
});

test("processing buffer creates a layer (F14)", async ({ page }) => {
  await demo(page);
  await page.locator('.rail-btn[aria-label="Processing tools"]').click();
  await page.locator(".alg-list button", { hasText: "Buffer" }).first().click();
  await page.locator(".panel button.primary", { hasText: "Run" }).click();
  await expect.poll(async () => (await layers(page)).map((l: { name: string }) => l.name).join()).toContain("Buffer");
});

test("command palette runs actions (Ctrl+K)", async ({ page }) => {
  await demo(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("toggle rivers");
  await page.keyboard.press("Enter");
  await expect(page.locator(".node", { hasText: "Rivers" }).locator("input[type=checkbox]")).not.toBeChecked();
});

test("publishing is blocked while layers are local (F17)", async ({ page }) => {
  await demo(page);
  await page.locator("button", { hasText: "Share" }).click();
  await expect(page.locator(".check.error")).toContainText("Countries");
});

test("map-only view for embedding (F5)", async ({ page }) => {
  await demo(page, "?url=projects/world/world.qgz&maponly");
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".rail")).toHaveCount(0);
});

test("QGIS Hub lists styles (F16)", async ({ page }) => {
  test.skip(!existsSync("public/hub/index.json"), "Hub mirror not built (run scripts/hub-mirror.mjs)");
  await demo(page);
  await page.locator('.rail-btn[aria-label="QGIS Hub"]').click();
  await expect(page.locator(".hub-grid li").first()).toBeVisible();
});

test("phones get the bottom tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await demo(page);
  const rail = (await page.locator(".rail").boundingBox())!;
  expect(rail.y).toBeGreaterThan(700);
});

test("open project on launch: blank, most recent, specific", async ({ page }) => {
  const phase = () => page.evaluate(() => [(globalThis as any).qgisWebApp.ui.phase, (globalThis as any).qgisWebApp.ui.projectName]);
  await boot(page);
  expect((await phase())[0]).toBe("empty");
  const set = (s: object) => page.evaluate((s) => (globalThis as any).qgisWebApp.settings.saveSettings(s), s);

  await set({ startup: "blank", specific: null });
  await page.reload();
  await expect.poll(phase).toEqual(["ready", "Untitled"]);

  await page.evaluate(() => (globalThis as any).qgisWebApp.actions.openUrl("reference/points_4326/points_4326.qgz"));
  await set({ startup: "last", specific: null });
  await page.reload();
  await expect.poll(phase).toEqual(["ready", "points_4326"]);

  await set({ startup: "specific", specific: { kind: "url", url: new URL("projects/world/world.qgz", page.url()).href, name: "Demo" } });
  await page.reload();
  await expect.poll(phase).toEqual(["ready", "World (Natural Earth 1:110m)"]);
});


test("undo and redo project changes", async ({ page }) => {
  await demo(page);
  await page.evaluate(() => { const { tree } = (globalThis as any).qgisWebApp; tree.rename(tree.snapshotTree()[0], "Renamed"); });
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => (globalThis as any).qgisWebApp.tree.snapshotTree()[0].name)).toBe("Places");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => page.evaluate(() => (globalThis as any).qgisWebApp.tree.snapshotTree()[0].name)).toBe("Renamed");
});

test("measure distance", async ({ page }) => {
  await demo(page);
  await page.locator('button[aria-label="Measure distance"]').click();
  const box = (await page.locator(".map").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(page.locator(".measure-readout")).toContainText("km");
});

test("export map image", async ({ page }) => {
  await demo(page);
  await page.locator('button[aria-label="Export map image"]').click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".dialog button.primary").click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test("rectangle selection syncs with the attribute table", async ({ page }) => {
  await demo(page);
  await page.locator(".node", { hasText: "Countries" }).locator(".name").click();
  await page.locator('button[aria-label="Selection tools"]').click();
  await page.locator(".tool-menu button", { hasText: "rectangle" }).click();
  const box = (await page.locator(".map").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await page.locator('.rail-btn[aria-label="Attribute table"]').click();
  await expect(page.locator(".drawer h3")).toContainText("selected");
});

test("field calculator creates a field from an expression", async ({ page }) => {
  await demo(page);
  page.on("dialog", (d) => d.accept());
  await page.evaluate(() => { const A = (globalThis as any).qgisWebApp; A.ui.current = A.tree.flatLayers(A.tree.snapshotTree()).find((l: any) => l.name === "Countries").layerId; A.ui.dialog = "field-calc"; });
  await page.locator(".dialog input").first().fill("name_upper");
  await page.locator(".dialog select").first().selectOption("TEXT");
  await page.locator(".dialog .expr-input input").fill('upper("NAME")');
  await page.locator(".dialog .expr-input input").press("Tab");
  await page.locator(".dialog button.primary").click();
  await expect.poll(() => page.evaluate(() => { const A = (globalThis as any).qgisWebApp; const id = A.tree.flatLayers(A.tree.snapshotTree()).find((l: any) => l.name === "Countries").layerId; const api = (globalThis as any).qgisWeb.api; const r = new api.QgsFeatureRequest(); r.setFilterFid(16); return A.engine.findMapLayer(id).getFeatures(r).nextFeature()?.attribute("name_upper"); })).toBe("CHAD");
});

test("CSV with coordinates becomes a delimited text layer", async ({ page }) => {
  await demo(page);
  const added = page.evaluate(() => (globalThis as any).qgisWebApp.adddata.addData([{ path: "pts.csv", data: new TextEncoder().encode("name,lon,lat\nParis,2.35,48.85\nRome,12.5,41.9\n") }]));
  await page.locator(".dialog.csv button.primary").click();
  await added;
  const n = await page.evaluate(() => { const A = (globalThis as any).qgisWebApp; const l = A.tree.flatLayers(A.tree.snapshotTree()).find((x: any) => x.name === "pts"); const it = A.engine.findMapLayer(l.layerId).getFeatures(); let k = 0; while (it.nextFeature()) k++; return k; });
  expect(n).toBe(2);
});

test("rule-based style from categories", async ({ page }) => {
  await demo(page);
  const rules = await page.evaluate(() => { const A = (globalThis as any).qgisWebApp; const id = A.tree.flatLayers(A.tree.snapshotTree()).find((l: any) => l.name === "Countries").layerId; A.apply(() => A.style.setRuleBased(id)); return A.style.readRules(id).length; });
  expect(rules).toBe(8);
});

test("compare view shows a second map", async ({ page }) => {
  await demo(page);
  await page.locator('button[aria-label="Compare"]').click();
  await expect(page.locator(".compare-map")).toBeVisible();
  await expect(page.locator(".swipe-divider")).toBeVisible();
});

test("embed API answers the parent page", async ({ page, baseURL }) => {
  // A host page on the same origin, served cross-origin isolated like the app.
  await page.route("**/embed-host.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
      body: `<iframe id="m" src="${baseURL}?url=projects/world/world.qgz&maponly" width="800" height="500" allow="cross-origin-isolated"></iframe>
<script>let n=0;const p=new Map();addEventListener("message",e=>{if(e.data?.qgisweb===1&&!e.data.event)p.get(e.data.id)?.(e.data)});
window.call=(command,args)=>new Promise(r=>{const id=++n;p.set(id,r);document.getElementById("m").contentWindow.postMessage({qgisweb:1,id,command,args},location.origin)});</script>`,
    }),
  );
  await page.goto("embed-host.html");
  await expect.poll(async () => (await page.evaluate(() => (window as any).call("hello"))).result?.ready, { timeout: 150_000 }).toBe(true);
  const layers = await page.evaluate(() => (window as any).call("getLayers"));
  expect(layers.result.map((l: { name: string }) => l.name)).toEqual(["Places", "Rivers", "Countries"]);
  const n = await page.evaluate(() => (window as any).call("selectByExpression", { layer: "Countries", expression: `"CONTINENT" = 'Africa'` }));
  expect(n.result).toBe(51);
});
