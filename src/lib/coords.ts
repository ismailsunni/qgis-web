import proj4 from "proj4";
import type { CoordFormat } from "./settings";

/** Coordinate readouts: project CRS, decimal degrees, degrees-minutes-seconds and UTM. */

export const FORMATS: CoordFormat[] = ["decimal", "dms", "utm", "project"];
export const FORMAT_LABELS: Record<CoordFormat, string> = { decimal: "Latitude, longitude", dms: "Degrees, minutes, seconds", utm: "UTM (WGS 84)", project: "Project CRS" };

function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  let d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 60) (s = 0), m++;
  if (m >= 60) (m = 0), d++;
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(1).padStart(4, "0")}″${v < 0 ? neg : pos}`;
}

/** UTM zone, hemisphere, easting and northing of a WGS 84 position. */
export function utm(lon: number, lat: number) {
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  const south = lat < 0;
  const [e, n] = proj4("EPSG:4326", `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
  return { zone, band: south ? "S" : "N", e, n };
}

export function formatCoord(format: CoordFormat, projected: number[], lonlat: number[] | null) {
  if (format === "project" || !lonlat) {
    const digits = Math.abs(projected[0]) < 400 && Math.abs(projected[1]) < 400 ? 5 : 1;
    return `${projected[0].toFixed(digits)}, ${projected[1].toFixed(digits)}`;
  }
  const [lon, lat] = lonlat;
  if (format === "decimal") return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  if (format === "dms") return `${dms(lat, "N", "S")} ${dms(lon, "E", "W")}`;
  if (Math.abs(lat) > 84) return "outside UTM";
  const u = utm(lon, lat);
  return `${u.zone}${u.band} ${Math.round(u.e)}E ${Math.round(u.n)}N`;
}
