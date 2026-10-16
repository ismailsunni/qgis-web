import { describe, expect, it } from "vitest";
import { rampColors, toHex, toQgis, alphaOf, pretty } from "../../src/lib/style";
import { toMulti } from "../../src/lib/processing";

describe("colors", () => {
  it("converts between QGIS and hex colors", () => {
    expect(toHex("141,211,199,255,rgb:0.55,0.83,0.78,1")).toBe("#8dd3c7");
    expect(toQgis("#8dd3c7")).toBe("141,211,199,255");
    expect(alphaOf("0,0,0,128")).toBeCloseTo(0.5, 2);
  });

  it("interpolates sequential ramps and cycles qualitative ones", () => {
    expect(rampColors("Blues", 2)).toEqual(["#f7fbff", "#08306b"]);
    expect(rampColors("Bold", 10)[9]).toBe(rampColors("Bold", 10)[0]);
  });
});

describe("toMulti", () => {
  it("wraps single polygons as QGIS outputs do", () => {
    const point = new Uint8Array([1, 1, 0, 0, 0, ...new Uint8Array(new Float64Array([1, 2]).buffer)]);
    const multi = toMulti(point)!;
    expect(new DataView(multi.buffer).getUint32(1, true)).toBe(4);
    expect(new DataView(multi.buffer).getUint32(5, true)).toBe(1);
  });
});

describe("pretty breaks", () => {
  // Expected values from QgsSymbolLayerUtils.prettyBreaks (QGIS Desktop).
  const cases: [number, number, number, number[]][] = [
    [0, 100, 5, [20, 40, 60, 80, 100]],
    [140, 1397715000, 5, [2e8, 4e8, 6e8, 8e8, 1e9, 1.2e9, 1397715000]],
    [-1.71, 1.71, 5, [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 1.71]],
    [-0.286, 8.97, 7, [0, 1, 2, 3, 4, 5, 6, 7, 8, 8.97]],
    [3, 3.0000001, 4, [3]],
    [0.5, 7.2, 10, [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.2]],
  ];
  it.each(cases)("%s to %s in %s classes", (min, max, n, expected) => {
    expect(pretty(min, max, n).map((b) => +b.toFixed(6))).toEqual(expected);
  });
});
