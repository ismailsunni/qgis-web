import type LineString from "ol/geom/LineString";
import { getDistance } from "ol/sphere";
import proj4 from "proj4";
import { LayerType } from "qgis-js";
import { layerSource, project } from "./doc";
import { engine, exists, findMapLayer, readFile } from "./engine";
import { crsByAuthid } from "./crs";
import { projectToLonLat, startLineTool } from "./maptools";
import { flatLayers, snapshotTree } from "./tree";
import { ui, toast } from "./state.svelte";

/** Elevation profiles along a drawn line, sampled from a DEM raster layer (local GeoTIFF). */

export interface Profile { layer: string; points: { d: number; z: number | null; xy: number[] }[]; length: number; min: number; max: number; gain: number; loss: number }

/** Raster layers that can be sampled: GeoTIFFs in the project. */
export function demLayers() {
  return flatLayers(snapshotTree()).filter((l) => {
    if (!l.valid || l.layerType !== LayerType.Raster) return false;
    const { provider, datasource } = layerSource(l.layerId!);
    return provider === "gdal" && /\.tiff?$/i.test(datasource);
  });
}

const samplers = new Map<string, Promise<(x: number, y: number) => Promise<number | null>>>();

/** Reads band 1 at raster CRS coordinates (nearest pixel, nodata as null). */
function sampler(layerId: string) {
  const { datasource } = layerSource(layerId);
  const d = project();
  const path = datasource.startsWith("/") ? datasource : `${d.dir}/${datasource.replace(/^\.\//, "")}`;
  if (!samplers.has(path)) {
    samplers.set(
      path,
      (async () => {
        if (!exists(path)) throw new Error("The raster's file isn't available");
        const { fromArrayBuffer } = await import("geotiff");
        const image = await (await fromArrayBuffer(readFile(path).slice().buffer)).getImage();
        const [ox, oy] = image.getOrigin();
        const [rx, ry] = image.getResolution();
        const nodata = image.getGDALNoData();
        const [w, h] = [image.getWidth(), image.getHeight()];
        return async (x: number, y: number) => {
          const px = Math.floor((x - ox) / rx), py = Math.floor((y - oy) / ry);
          if (px < 0 || py < 0 || px >= w || py >= h) return null;
          const [band] = (await image.readRasters({ window: [px, py, px + 1, py + 1], samples: [0] })) as unknown as ArrayLike<number>[];
          const v = band[0];
          return Number.isFinite(v) && v !== nodata ? v : null;
        };
      })(),
    );
  }
  return samplers.get(path)!;
}

export async function computeProfile(line: LineString, layerId: string, samples = 400): Promise<Profile> {
  const layer = findMapLayer(layerId)!;
  const sample = await sampler(layerId);
  const projectDef = engine().projectVariables()["project_crs_proj4"];
  const rasterDef = (await crsByAuthid(layer.crs()))?.proj4;
  const toRaster = projectDef && rasterDef && projectDef !== rasterDef ? proj4(projectDef, rasterDef).forward : (c: number[]) => c;
  const points: Profile["points"] = [];
  let d = 0;
  let prevLonLat: number[] | null = null;
  let prevXY: number[] | null = null;
  for (let i = 0; i <= samples; i++) {
    const xy = line.getCoordinateAt(i / samples);
    // Distances on the ellipsoid when the project CRS can be converted to WGS 84.
    const ll = projectToLonLat(xy);
    if (prevXY) d += ll && prevLonLat ? getDistance(prevLonLat, ll) : Math.hypot(xy[0] - prevXY[0], xy[1] - prevXY[1]);
    const [rx, ry] = toRaster(xy) as number[];
    points.push({ d, z: await sample(rx, ry), xy });
    prevLonLat = ll;
    prevXY = xy;
  }
  const zs = points.map((p) => p.z).filter((z): z is number => z !== null);
  if (!zs.length) throw new Error(`The line doesn't cross ${layer.name}`);
  let gain = 0, loss = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1].z, points[i].z];
    if (a !== null && b !== null) b > a ? (gain += b - a) : (loss += a - b);
  }
  return { layer: layer.name, points, length: d, min: Math.min(...zs), max: Math.max(...zs), gain, loss };
}

/** Starts drawing a profile line; the result opens in the profile drawer. */
export function startProfile() {
  const dems = demLayers();
  if (!dems.length) return toast("Add an elevation raster (GeoTIFF) to draw a profile.");
  const layerId = dems.find((l) => l.layerId === ui.current)?.layerId ?? dems[0].layerId!;
  startLineTool(async (line) => {
    try {
      ui.profile = await computeProfile(line, layerId);
    } catch (e) {
      toast((e as Error).message);
    }
  });
  ui.mapTool = "profile";
  toast(`Draw a line to profile ${findMapLayer(layerId)?.name}; double-click to finish.`);
}
