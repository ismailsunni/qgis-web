import { describe, expect, it } from "vitest";
import { formatCoord, utm } from "../../src/lib/coords";

describe("coordinate formats", () => {
  it("formats degrees, minutes and seconds", () => {
    expect(formatCoord("dms", [0, 0], [2.3522, 48.8566])).toBe("48°51′23.8″N 2°21′07.9″E");
    expect(formatCoord("dms", [0, 0], [-58.3816, -34.6037])).toBe("34°36′13.3″S 58°22′53.8″W");
  });

  it("computes UTM like the EPSG UTM zones", () => {
    // Paris is in zone 31N; PROJ (cs2cs EPSG:4326 to EPSG:32631) gives 452482.53 E, 5411717.18 N.
    const u = utm(2.3522, 48.8566);
    expect([u.zone, u.band]).toEqual([31, "N"]);
    expect(u.e).toBeCloseTo(452482.53, 0);
    expect(u.n).toBeCloseTo(5411717.18, 0);
  });
});
