import TileLayer from "ol/layer/Tile";
import VectorTileLayer from "ol/layer/VectorTile";
import XYZ from "ol/source/XYZ";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import type ImageTile from "ol/ImageTile";
import type VectorTile from "ol/VectorTile";
import { gunzipSync } from "fflate";
import { openDb } from "./sqlite";
import { readFile } from "./engine";
import { project } from "./doc";

/** MBTiles drawn by the browser from the SQLite file (the engine's GDAL can't decode the tiles). */
export function mbtilesLayer(path: string, raster: boolean) {
  const layer = raster ? new TileLayer() : new VectorTileLayer();
  const abs = path.startsWith("/") ? path : `${project().dir}/${path.replace(/^\.\//, "")}`;
  openDb(readFile(abs)).then((db) => {
    const meta = Object.fromEntries(db.rows<{ name: string; value: string }>("select name, value from metadata").map((r) => [r.name, r.value]));
    const zoom = { minZoom: Number(meta.minzoom ?? 0), maxZoom: Number(meta.maxzoom ?? 22), url: "{z}/{x}/{y}" };
    // MBTiles rows count from the bottom (TMS).
    const get = ([z, x, y]: number[]) =>
      db.rows<{ tile_data: Uint8Array }>("select tile_data from tiles where zoom_level = ? and tile_column = ? and tile_row = ?", [z, x, 2 ** z - 1 - y])[0]?.tile_data;
    if (raster)
      (layer as TileLayer).setSource(
        new XYZ({
          ...zoom,
          tileLoadFunction: (tile) => {
            const data = get((tile as ImageTile).getTileCoord());
            if (!data) return tile.setState(4);
            const img = (tile as ImageTile).getImage() as HTMLImageElement;
            img.src = URL.createObjectURL(new Blob([data as BlobPart]));
            img.onload = () => URL.revokeObjectURL(img.src);
          },
        }),
      );
    else {
      const format = new MVT();
      (layer as VectorTileLayer).setSource(
        new VectorTileSource({
          ...zoom,
          format,
          tileLoadFunction: (tile) => {
            const t = tile as VectorTile<never>;
            t.setLoader((extent, _res, projection) => {
              const data = get(t.getTileCoord());
              const bytes = !data ? null : data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
              t.setFeatures(bytes ? (format.readFeatures(bytes.slice().buffer, { extent, featureProjection: projection }) as never) : []);
            });
          },
        }),
      );
    }
  });
  return layer;
}
