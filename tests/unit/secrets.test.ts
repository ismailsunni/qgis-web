import { describe, expect, it } from "vitest";
import { cleanDatasource, stripSecrets } from "../../src/lib/secrets";

const SECRETS = /hunter2|abc123|xyz789|s3cr3t|tok-en/;

describe("cleanDatasource (F19)", () => {
  it.each([
    ["XYZ url token", "type=xyz&url=https://t.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.png?token%3Dabc123%26style%3Dlight&zmax=19&zmin=0"],
    ["WMS authcfg and password", "contextualWMSLegend=0&crs=EPSG:3857&format=image/png&layers=a&password=hunter2&username=me&authcfg=xyz789&url=https://wms.example.com/ows"],
    ["WFS quoted", "authcfg='xyz789' password='hunter2' typename='ns:roads' url='https://wfs.example.com/wfs?apikey=s3cr3t' user='me' version='auto'"],
    ["vsicurl signed URL", "/vsicurl/https://bucket.example.com/a.tif?sig=tok-en&x=1"],
  ])("removes credentials: %s", (_, ds) => {
    const clean = cleanDatasource(ds);
    expect(clean).not.toMatch(SECRETS);
    expect(clean).not.toMatch(/authcfg|password|username/);
  });

  it("keeps everything else intact", () => {
    expect(cleanDatasource("type=xyz&url=https://tile.openstreetmap.org/%7Bz%7D/%7Bx%7D/%7By%7D.png&zmax=19&zmin=0")).toBe(
      "type=xyz&url=https://tile.openstreetmap.org/%7Bz%7D/%7Bx%7D/%7By%7D.png&zmax=19&zmin=0",
    );
    expect(cleanDatasource("./data/world.gpkg|layername=countries")).toBe("./data/world.gpkg|layername=countries");
    expect(cleanDatasource("typename='ns:roads' url='https://wfs.example.com/wfs' version='auto'")).toBe("typename='ns:roads' url='https://wfs.example.com/wfs' version='auto'");
  });
});

describe("stripSecrets", () => {
  it("leaves no secret anywhere in a project", () => {
    const xml = new DOMParser().parseFromString(
      `<qgis><layer-tree-group><layer-tree-layer id="a_1" source="password=hunter2&amp;url=https://x.example.com"/></layer-tree-group>
       <projectlayers><maplayer><id>a_1</id><datasource>password=hunter2&amp;url=https://x.example.com/?token%3Dabc123</datasource><authcfg>xyz789</authcfg></maplayer></projectlayers></qgis>`,
      "application/xml",
    );
    stripSecrets(xml);
    expect(new XMLSerializer().serializeToString(xml)).not.toMatch(SECRETS);
  });
});
