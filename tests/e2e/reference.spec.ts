import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { boot, openProject, layers, render } from "./helpers";

/**
 * F1/F2 acceptance: the reference projects open with no errors and render like QGIS Desktop
 * (tests/reference/*.png, made by scripts/make_reference_projects.py).
 */
const manifest: { name: string; project: string; extent: number[]; width: number; height: number; labels: boolean }[] = JSON.parse(
  readFileSync("tests/reference/manifest.json", "utf8"),
);

/** Max share of differing pixels. Labels allow more: the engine has fewer fonts than Desktop. */
const MAX_DIFF = 0.01;
const MAX_DIFF_LABELS = 0.03;

for (const ref of manifest) {
  test(`reference project ${ref.name} opens and renders like QGIS Desktop`, async ({ page }) => {
    await boot(page);
    await openProject(page, ref.project);
    const all = await layers(page);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((l: { valid: boolean }) => !l.valid)).toEqual([]);

    const actual = await render(page, ref.extent, ref.width, ref.height);
    const expected = PNG.sync.read(readFileSync(`tests/reference/${ref.name}.png`));
    const diff = new PNG({ width: ref.width, height: ref.height });
    const mismatched = pixelmatch(expected.data, actual.data, diff.data, ref.width, ref.height, { threshold: 0.15 });
    const ratio = mismatched / (ref.width * ref.height);
    mkdirSync("test-results/render", { recursive: true });
    writeFileSync(`test-results/render/${ref.name}.png`, PNG.sync.write(actual));
    writeFileSync(`test-results/render/${ref.name}.diff.png`, PNG.sync.write(diff));
    test.info().annotations.push({ type: "pixel diff", description: `${(ratio * 100).toFixed(3)}%` });
    console.log(`${ref.name}: ${(ratio * 100).toFixed(3)}% pixels differ`);
    expect(ratio).toBeLessThan(ref.labels ? MAX_DIFF_LABELS : MAX_DIFF);
  });
}
