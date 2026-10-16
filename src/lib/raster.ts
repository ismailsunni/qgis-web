import renderersXml from "../templates/renderers.xml?raw";
import { child, layerSource, mapLayerEl, project } from "./doc";
import proj4 from "proj4";
import type { GeoTIFFImage } from "geotiff";
import { engine, exists, findMapLayer, readFile } from "./engine";
import { crsByAuthid } from "./crs";
import { rampColors } from "./style";

/** Raster styling on the layer's <pipe><rasterrenderer>, in QGIS's format. */

const templates = new DOMParser().parseFromString(renderersXml, "application/xml");

export type RasterType = "singlebandpseudocolor" | "singlebandgray" | "hillshade" | "multibandcolor";

export interface BandStats { min: number; max: number; histogram?: number[] }
export interface RasterInfo { bands: number; stats: BandStats[] }

function tiffPath(layerId: string) {
  const { provider, datasource } = layerSource(layerId);
  const path = datasource.startsWith("/") ? datasource : `${project().dir}/${datasource.replace(/^\.\//, "")}`;
  return provider === "gdal" && /\.tiff?$/i.test(path) && exists(path) ? path : null;
}

export const isGeoTiff = (layerId: string) => !!tiffPath(layerId);

const images = new Map<string, Promise<GeoTIFFImage>>();
function tiffImage(path: string) {
  if (!images.has(path)) images.set(path, import("geotiff").then(async ({ fromArrayBuffer }) => (await fromArrayBuffer(readFile(path).slice().buffer)).getImage()));
  return images.get(path)!;
}

const cache = new Map<string, Promise<RasterInfo | null>>();

/** Band count, value range and histogram of a local GeoTIFF (sampled overview), or null for other sources. */
export function rasterInfo(layerId: string): Promise<RasterInfo | null> {
  const path = tiffPath(layerId);
  if (!path) return Promise.resolve(null);
  if (!cache.has(path)) {
    cache.set(
      path,
      (async () => {
        const image = await tiffImage(path);
        const bands = image.getSamplesPerPixel();
        const nodata = image.getGDALNoData();
        const scale = Math.max(1, Math.ceil(Math.max(image.getWidth(), image.getHeight()) / 512));
        const data = (await image.readRasters({ width: Math.ceil(image.getWidth() / scale), height: Math.ceil(image.getHeight() / scale) })) as unknown as ArrayLike<number>[];
        const stats = Array.from({ length: bands }, (_, b) => {
          const values = Array.from(data[b]).filter((v) => Number.isFinite(v) && v !== nodata);
          let min = Infinity, max = -Infinity;
          for (const v of values) (min = Math.min(min, v)), (max = Math.max(max, v));
          const histogram = new Array(64).fill(0);
          for (const v of values) histogram[Math.min(63, Math.floor(((v - min) / (max - min || 1)) * 64))]++;
          return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 1 : max, histogram };
        });
        return { bands, stats };
      })().catch(() => null),
    );
  }
  return cache.get(path)!;
}

/** Reads every band's value at a project-CRS position (nearest pixel; nodata and outside as null). */
export async function pixelSampler(layerId: string) {
  const path = tiffPath(layerId);
  if (!path) return null;
  const image = await tiffImage(path);
  const projectDef = engine().projectVariables()["project_crs_proj4"];
  const rasterDef = (await crsByAuthid(findMapLayer(layerId)?.crs() ?? ""))?.proj4;
  const toRaster = projectDef && rasterDef && projectDef !== rasterDef ? proj4(projectDef, rasterDef).forward : (c: number[]) => c;
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const nodata = image.getGDALNoData();
  const [w, h] = [image.getWidth(), image.getHeight()];
  return async (xy: number[]) => {
    const [x, y] = toRaster(xy) as number[];
    const px = Math.floor((x - ox) / rx), py = Math.floor((y - oy) / ry);
    if (!(px >= 0 && py >= 0 && px < w && py < h)) return null;
    const bands = (await image.readRasters({ window: [px, py, px + 1, py + 1] })) as unknown as ArrayLike<number>[];
    return bands.map((b) => (Number.isFinite(b[0]) && b[0] !== nodata ? b[0] : null));
  };
}

const rendererEl = (id: string) => mapLayerEl(id)?.querySelector("pipe > rasterrenderer") ?? null;

export interface RasterStyle {
  type: string;
  band: number;
  min: number;
  max: number;
  ramp: string;
  red: number;
  green: number;
  blue: number;
  azimuth: number;
  altitude: number;
  zFactor: number;
  multidirectional: boolean;
}

const num = (el: Element | null | undefined, sel: string, d: number) => Number(el?.querySelector(sel)?.textContent ?? d);

export function readRasterStyle(id: string): RasterStyle {
  const r = rendererEl(id);
  const shader = r?.querySelector("rastershader > colorrampshader");
  return {
    type: r?.getAttribute("type") ?? "",
    band: Number(r?.getAttribute("band") ?? r?.getAttribute("grayBand") ?? 1),
    min: Number(shader?.getAttribute("minimumValue") ?? num(r, "contrastEnhancement > minValue", 0)),
    max: Number(shader?.getAttribute("maximumValue") ?? num(r, "contrastEnhancement > maxValue", 255)),
    ramp: r?.getAttribute("quarkgis_ramp") ?? "Viridis",
    red: Number(r?.getAttribute("redBand") ?? 1),
    green: Number(r?.getAttribute("greenBand") ?? 2),
    blue: Number(r?.getAttribute("blueBand") ?? 3),
    azimuth: Number(r?.getAttribute("azimuth") ?? 315),
    altitude: Number(r?.getAttribute("angle") ?? 45),
    zFactor: Number(r?.getAttribute("zfactor") ?? 1),
    multidirectional: r?.getAttribute("multidirection") === "1",
  };
}

function contrast(name: string, s: BandStats) {
  const xml = project().xml;
  const el = xml.createElement(name);
  const add = (tag: string, text: string) => el.appendChild(Object.assign(xml.createElement(tag), { textContent: text }));
  add("minValue", String(s.min));
  add("maxValue", String(s.max));
  add("algorithm", "StretchToMinimumMaximum");
  return el;
}

/** Replaces the layer's raster renderer, keeping its opacity and the rest of the pipe. */
export function setRasterStyle(id: string, type: RasterType, s: RasterStyle, info: RasterInfo | null) {
  const layer = mapLayerEl(id)!;
  const pipe = child(layer, "pipe");
  const old = rendererEl(id);
  const r = project().xml.importNode(templates.querySelector(`templates > rasterrenderer[type="${type}"]`)!, true) as Element;
  r.setAttribute("opacity", old?.getAttribute("opacity") ?? "1");
  const stats = (b: number): BandStats => (b === s.band ? { min: s.min, max: s.max } : info?.stats[b - 1] ?? { min: 0, max: 255 });
  if (type === "singlebandpseudocolor") {
    r.setAttribute("band", String(s.band));
    r.setAttribute("classificationMin", String(s.min));
    r.setAttribute("classificationMax", String(s.max));
    r.setAttribute("quarkgis_ramp", s.ramp);
    const shader = r.querySelector("rastershader > colorrampshader")!;
    shader.setAttribute("minimumValue", String(s.min));
    shader.setAttribute("maximumValue", String(s.max));
    shader.querySelectorAll(":scope > item").forEach((i) => i.remove());
    const colors = rampColors(s.ramp, 7);
    const first = shader.firstChild;
    colors.forEach((c, i) => {
      const v = s.min + ((s.max - s.min) * i) / (colors.length - 1);
      const item = project().xml.createElement("item");
      for (const [k, val] of Object.entries({ alpha: "255", color: c, label: String(+v.toPrecision(6)), value: String(v) })) item.setAttribute(k, val);
      shader.insertBefore(item, first);
    });
  } else if (type === "singlebandgray") {
    r.setAttribute("grayBand", String(s.band));
    r.appendChild(contrast("contrastEnhancement", stats(s.band)));
  } else if (type === "hillshade") {
    r.setAttribute("band", String(s.band));
    r.setAttribute("azimuth", String(s.azimuth));
    r.setAttribute("angle", String(s.altitude));
    r.setAttribute("zfactor", String(s.zFactor));
    r.setAttribute("multidirection", s.multidirectional ? "1" : "0");
  } else {
    r.setAttribute("redBand", String(s.red));
    r.setAttribute("greenBand", String(s.green));
    r.setAttribute("blueBand", String(s.blue));
    for (const [name, band] of [["redContrastEnhancement", s.red], ["greenContrastEnhancement", s.green], ["blueContrastEnhancement", s.blue]] as const) r.appendChild(contrast(name, stats(band)));
  }
  if (old) old.replaceWith(r);
  else pipe.appendChild(r);
}
