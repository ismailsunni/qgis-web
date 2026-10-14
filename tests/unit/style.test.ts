import { describe, expect, it } from "vitest";
import { rampColors, toHex, toQgis, alphaOf } from "../../src/lib/style";
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
