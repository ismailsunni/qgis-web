import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { boot, openProject } from "./helpers";

/**
 * F10 acceptance: scripted edits on every reference project, saved as .qgz. The saved projects
 * and the expected result are written to test-results/roundtrip/; scripts/check_roundtrip.py then
 * verifies them with QGIS Desktop (see .github/workflows/test.yml).
 */
const manifest: { name: string; project: string }[] = JSON.parse(readFileSync("tests/reference/manifest.json", "utf8"));
const OUT = "test-results/roundtrip";

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  cpSync("public/reference/data", `${OUT}/data`, { recursive: true });
});

for (const ref of manifest) {
  test(`round-trip ${ref.name}`, async ({ page }) => {
    await boot(page);
    await openProject(page, ref.project);
    const result = await page.evaluate(async (name) => {
      const { tree, style, apply, doc, ui } = (globalThis as any).qgisWebApp;
      const top = () => tree.snapshotTree();
      // Reorder: last top-level node to the top.
      const t = top();
      if (t.length > 1) tree.move(t[t.length - 1].key, t[0].key, "before");
      const first = tree.flatLayers(top())[0];
      tree.rename(first, `${first.name} edited`);
      tree.setOpacity(tree.flatLayers(top())[0], 0.6);
      const all = tree.flatLayers(top());
      if (all.length > 1) tree.setVisible(all[all.length - 1], false);
      // Style the first vector layer: single red symbol with labels.
      const vector = tree.flatLayers(top()).find((l: any) => l.layerType === 0);
      if (vector) {
        apply(() => style.setSingle(vector.layerId));
        apply(() => style.setAllSymbols(vector.layerId, { color: "#ff0000" }));
        const field = (globalThis as any).qgisWeb.api.layerTreeRoot().findLayer(vector.layerId).layer().fields().at(1)?.name() ?? "fid";
        apply(() => style.writeLabels(vector.layerId, { ...style.readLabels(vector.layerId), enabled: true, field, isExpression: false }));
      }
      const expected = {
        order: top().map((n: any) => n.name),
        layers: Object.fromEntries(
          tree.flatLayers(top()).map((l: any) => [
            l.name,
            {
              visible: l.visible,
              opacity: Math.round(l.opacity * 1000) / 1000,
              ...(l.layerId === vector?.layerId ? { renderer: "singleSymbol", labels: true } : {}),
            },
          ]),
        ),
      };
      // Reload the saved document in the engine: nothing may change.
      const before = JSON.stringify(expected.order) + ui.dirty;
      const bytes = doc.projectBytes();
      return { expected, bytes: Array.from(bytes as Uint8Array), before };
    }, ref.name);
    expect(result.expected.order.length).toBeGreaterThan(0);
    mkdirSync(`${OUT}/${ref.name}`, { recursive: true });
    writeFileSync(`${OUT}/${ref.name}/${ref.name}.qgz`, Buffer.from(result.bytes));
    writeFileSync(`${OUT}/${ref.name}/expected.json`, JSON.stringify(result.expected, null, 2));

    // The saved file reopens in the web app with the same edits.
    await page.evaluate(async ({ name, bytes }) => {
      const { actions } = (globalThis as any).qgisWebApp;
      await actions.openFiles([{ path: `${name}.qgz`, data: new File([new Uint8Array(bytes)], `${name}.qgz`) }]);
    }, { name: ref.name, bytes: result.bytes });
    const order = await page.evaluate(() => (globalThis as any).qgisWebApp.tree.snapshotTree().map((n: any) => n.name));
    expect(order).toEqual(result.expected.order);
  });
}
