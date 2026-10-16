import { describe, expect, it } from "vitest";
import { parseCsv, previewCsv, delimitedTextUri } from "../../src/lib/csv";

describe("CSV", () => {
  it("parses quoted cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n', ",")).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("guesses lon/lat columns and the delimiter", () => {
    const p = previewCsv("t", "name;Longitude;Latitude\nA;2.35;48.85\n");
    expect(p.guess).toMatchObject({ delimiter: ";", geometry: "xy", x: "Longitude", y: "Latitude", crs: "EPSG:4326" });
  });

  it("leaves the CRS open for projected coordinates", () => {
    expect(previewCsv("t", "x,y\n2600000,1200000\n").guess.crs).toBe("");
  });

  it("writes tabs as \\t, as QGIS does", () => {
    expect(delimitedTextUri("./a.tsv", { delimiter: "\t", geometry: "none", x: "", y: "", wkt: "", crs: "" })).toContain("delimiter=\\t&");
  });

  it("builds QGIS delimitedtext URIs", () => {
    expect(delimitedTextUri("./data/a.csv", { delimiter: ",", geometry: "wkt", x: "", y: "", wkt: "geom", crs: "EPSG:2056" })).toBe(
      "file:./data/a.csv?type=csv&delimiter=,&detectTypes=yes&skipEmptyFields=no&wktField=geom&crs=EPSG:2056&spatialIndex=no",
    );
  });
});
