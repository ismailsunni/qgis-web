import { describe, expect, it } from "vitest";
import { fieldStats } from "../../src/lib/stats";

describe("field statistics", () => {
  it("summarizes numbers like QGIS (sample standard deviation)", () => {
    const s = fieldStats([1, 2, 3, 4, null, 10]);
    expect(s).toMatchObject({ kind: "numeric", count: 5, nulls: 1, sum: 20, mean: 4, median: 3, min: 1, max: 10 });
    expect((s as { stddev: number }).stddev).toBeCloseTo(3.5355, 3);
    expect((s as { histogram: { n: number }[] }).histogram.reduce((a, b) => a + b.n, 0)).toBe(5);
  });

  it("counts text values", () => {
    expect(fieldStats(["a", "b", "a", null, ""])).toMatchObject({ kind: "text", count: 3, nulls: 2, unique: 2, top: [["a", 2], ["b", 1]] });
  });
});
