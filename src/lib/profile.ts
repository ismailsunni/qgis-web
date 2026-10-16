import type LineString from "ol/geom/LineString";
import { getDistance } from "ol/sphere";
import { LayerType } from "qgis-js";
import { findMapLayer } from "./engine";
import { isGeoTiff, pixelSampler } from "./raster";
import { projectToLonLat, startLineTool } from "./maptools";
import { flatLayers, snapshotTree } from "./tree";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";

/** Elevation profiles along a drawn line, sampled from a DEM raster layer (local GeoTIFF). */

export interface Profile { layer: string; points: { d: number; z: number | null; xy: number[] }[]; length: number; min: number; max: number; gain: number; loss: number }

/** Raster layers that can be sampled: GeoTIFFs in the project. */
export const demLayers = () => flatLayers(snapshotTree()).filter((l) => l.valid && l.layerType === LayerType.Raster && isGeoTiff(l.layerId!));

export async function computeProfile(line: LineString, layerId: string, samples = 400): Promise<Profile> {
  const layer = findMapLayer(layerId)!;
  const sample = await pixelSampler(layerId);
  if (!sample) throw new Error(t("The raster's file isn't available"));
  const points: Profile["points"] = [];
  let d = 0;
  let prevLonLat: number[] | null = null;
  let prevXY: number[] | null = null;
  for (let i = 0; i <= samples; i++) {
    const xy = line.getCoordinateAt(i / samples);
    // Distances on the ellipsoid when the project CRS can be converted to WGS 84.
    const ll = projectToLonLat(xy);
    if (prevXY) d += ll && prevLonLat ? getDistance(prevLonLat, ll) : Math.hypot(xy[0] - prevXY[0], xy[1] - prevXY[1]);
    points.push({ d, z: (await sample(xy))?.[0] ?? null, xy });
    prevLonLat = ll;
    prevXY = xy;
  }
  const zs = points.map((p) => p.z).filter((z): z is number => z !== null);
  if (!zs.length) throw new Error(t("The line doesn't cross {layer}", { layer: layer.name }));
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
  if (!dems.length) return toast(t("Add an elevation raster (GeoTIFF) to draw a profile."));
  const layerId = dems.find((l) => l.layerId === ui.current)?.layerId ?? dems[0].layerId!;
  startLineTool(async (line) => {
    try {
      ui.profile = await computeProfile(line, layerId);
    } catch (e) {
      toast((e as Error).message);
    }
  });
  ui.mapTool = "profile";
  toast(t("Draw a line to profile {layer}; double-click to finish.", { layer: findMapLayer(layerId)?.name ?? "" }));
}
