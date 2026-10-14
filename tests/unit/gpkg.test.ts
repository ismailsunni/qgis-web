import { describe, expect, it } from "vitest";
import { decodeBlob, encodeBlob, wkbBounds } from "../../src/lib/gpkg";

/** WKB polygon (little endian) for a closed ring of [x, y] pairs. */
function polygon(ring: number[][]) {
  const b = new DataView(new ArrayBuffer(1 + 4 + 4 + 4 + ring.length * 16));
  b.setUint8(0, 1);
  b.setUint32(1, 3, true);
  b.setUint32(5, 1, true);
  b.setUint32(9, ring.length, true);
  ring.forEach(([x, y], i) => (b.setFloat64(13 + i * 16, x, true), b.setFloat64(21 + i * 16, y, true)));
  return new Uint8Array(b.buffer);
}

describe("GeoPackage geometry blobs", () => {
  const wkb = polygon([[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]);

  it("computes WKB bounds", () => expect(wkbBounds(wkb)).toEqual([0, 0, 10, 5]));

  it("round-trips through a GPKG blob with envelope and SRS", () => {
    const blob = encodeBlob(wkb, 4326);
    expect([...blob.slice(0, 2)]).toEqual([0x47, 0x50]);
    const d = decodeBlob(blob)!;
    expect(d.srsId).toBe(4326);
    expect(d.bounds).toEqual([0, 0, 10, 5]);
    expect([...d.wkb]).toEqual([...wkb]);
  });
});
