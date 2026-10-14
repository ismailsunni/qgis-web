import type { Database } from "sql.js";
import { readFile } from "./engine";
import { openDb, rows } from "./sqlite";

/** CRS definitions from QGIS's own srs.db, shipped inside the engine. */

let srs: Promise<Database> | null = null;
const srsDb = () => (srs ??= openDb(readFile("/qgis/resources/srs.db")));

export interface CrsDef {
  authid?: string;
  description?: string;
  proj4?: string;
  wkt?: string;
  geographic?: boolean;
}

interface SrsRow { auth_name: string; auth_id: string; description: string; parameters: string; is_geo: number }

const toDef = (r: SrsRow): CrsDef => ({ authid: `${r.auth_name}:${r.auth_id}`, description: r.description, proj4: r.parameters, geographic: !!r.is_geo });

export async function crsByAuthid(authid: string): Promise<CrsDef | null> {
  const [auth, code] = authid.toUpperCase() === "OGC:CRS84" ? ["EPSG", "4326"] : authid.split(":");
  const [r] = rows<SrsRow>(await srsDb(), "select * from tbl_srs where upper(auth_name)=upper(?) and auth_id=?", [auth, code]);
  return r ? toDef(r) : null;
}

export async function searchCrs(q: string, limit = 50): Promise<CrsDef[]> {
  const like = `%${q}%`;
  return rows<SrsRow>(
    await srsDb(),
    "select * from tbl_srs where deprecated = 0 and (description like ? or auth_name || ':' || auth_id like ?) order by auth_name = 'EPSG' desc, cast(auth_id as integer) limit ?",
    [like, like, limit],
  ).map(toDef);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A <spatialrefsys> QGIS reads without any lookup. The definition (WKT or PROJ) is what makes
 * the engine reproject; an authid-only reference is not enough in the WebAssembly build.
 */
export function spatialRefSys(def: CrsDef) {
  const parts = def.wkt ? `<wkt>${esc(def.wkt)}</wkt>` : `<proj4>${esc(def.proj4 ?? "")}</proj4>`;
  return `<spatialrefsys nativeFormat="Wkt">${parts}<description>${esc(def.description ?? "")}</description><geographicflag>${def.geographic ? "true" : "false"}</geographicflag></spatialrefsys>`;
}
