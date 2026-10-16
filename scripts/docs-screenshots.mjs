// Screenshots for the documentation (docs/assets/screenshots), taken from a running app:
//   node scripts/docs-screenshots.mjs [http://localhost:5173/]   (CHROME_PATH to use a local Chrome)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = (name) => `docs/assets/screenshots/${name}.png`;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 820 }, locale: "en-US" });

async function demo() {
  await page.goto(url);
  await page.getByText("Try the demo").click();
  await page.waitForSelector(".statusbar", { timeout: 120_000 });
  await page.waitForTimeout(1500);
}
const app = (fn, arg) => page.evaluate(fn, arg);
const layer = (name) => app((n) => { const A = globalThis.qgisWebApp; return A.tree.flatLayers(A.tree.snapshotTree()).find((l) => l.name === n).layerId; }, name);

await page.goto(url);
await page.waitForSelector("text=Try the demo", { timeout: 120_000 });
await page.screenshot({ path: out("welcome") });

await demo();
await page.screenshot({ path: out("app") });

const countries = await layer("Countries");
await app((id) => { const A = globalThis.qgisWebApp; A.ui.current = id; A.ui.panel = "style"; A.apply(() => A.style.setGraduated(id, "POP_EST", A.style.classify(id, "POP_EST", "Jenks", 6, "YlOrRd"), "YlOrRd", "Jenks")); }, countries);
await page.waitForTimeout(1500);
await page.screenshot({ path: out("style") });

await app((id) => { const A = globalThis.qgisWebApp; A.ui.panel = "layers"; A.ui.tableLayerId = id; A.selection.selectByExpression(id, `"CONTINENT" = 'Africa'`, "new"); }, countries);
await page.waitForTimeout(1500);
await page.screenshot({ path: out("table") });

await app(() => { const A = globalThis.qgisWebApp; A.ui.tableLayerId = null; A.selection.clearSelection(); A.ui.panel = "tools"; A.ui.pendingAlgorithm = "native:buffer"; });
await page.waitForTimeout(1000);
await page.screenshot({ path: out("processing") });

await app(async (id) => { const A = globalThis.qgisWebApp; A.ui.panel = "layers"; await A.editing.startEditing(id); A.selection.selectByExpression(id, `"NAME" = 'France'`, "new"); A.editmap.setTool("move"); }, countries);
await page.waitForTimeout(1500);
await page.screenshot({ path: out("editing") });
await app(() => globalThis.qgisWebApp.editing.stopEditing());

await demo();
const dem = [...readFileSync("tests/fixtures/dem.tif")];
await app(async (b) => {
  const A = globalThis.qgisWebApp;
  const [id] = await A.adddata.addData([{ path: "dem.tif", data: new Uint8Array(b) }]);
  const e = A.engine.engine().fullExtent([id]);
  A.map.olMap().getView().fit([e.xMinimum, e.yMinimum, e.xMaximum, e.yMaximum], { padding: [60, 60, 60, 60] });
}, dem);
await page.locator('button[aria-label="Elevation profile"]').click();
const box = (await page.locator(".map").boundingBox());
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.45);
await page.mouse.dblclick(box.x + box.width * 0.75, box.y + box.height * 0.55);
await page.waitForTimeout(4500);
await page.screenshot({ path: out("profile") });

await demo();
const events = { type: "FeatureCollection", features: Array.from({ length: 60 }, (_, i) => ({ type: "Feature", properties: { when: `2024-${String(1 + (i % 12)).padStart(2, "0")}-15T12:00:00` }, geometry: { type: "Point", coordinates: [-10 + ((i * 37) % 45), 36 + ((i * 13) % 24)] } })) };
await app(async (fc) => { const A = globalThis.qgisWebApp; const [id] = await A.adddata.addData([{ path: "events.geojson", data: new TextEncoder().encode(JSON.stringify(fc)) }]); A.ui.current = id; A.ui.panel = "style"; A.map.olMap().getView().fit([-1500000, 3800000, 3500000, 7500000]); }, events);
await page.locator("section", { hasText: "Time (temporal controller)" }).locator('input[type="checkbox"]').first().check();
await page.locator('button[aria-label="Time slider"]').click();
await page.locator('button[aria-label="Next step"]').click();
await page.locator('button[aria-label="Next step"]').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: out("time") });

await browser.close();
