import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { transformExtent, get as getProjection } from "ol/proj";
import type { Extent } from "ol/extent";
import { project, findChild } from "./doc";
import { apply } from "./commit";
import { olMap, srid } from "./map";
import { engine } from "./engine";
import { N_ } from "./i18n";

/** Spatial bookmarks, stored in the project as QGIS does (<Bookmarks>), so Desktop shows them too. */

export interface Bookmark { id: string; name: string; group: string; extent: Extent; crs: Element | null }

const root = () => project().xml.querySelector("qgis > Bookmarks");

function bboxOf(wkt: string): Extent {
  const nums = (wkt.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function readBookmarks(): Bookmark[] {
  return [...(root()?.querySelectorAll(":scope > Bookmark") ?? [])].map((b) => ({
    id: b.getAttribute("id") ?? "",
    name: b.getAttribute("name") ?? "",
    group: b.getAttribute("group") ?? "",
    extent: bboxOf(b.getAttribute("extent") ?? ""),
    crs: b.querySelector("spatialrefsys"),
  }));
}

export function addBookmark(name: string, group = "") {
  const [x0, y0, x1, y1] = olMap().getView().calculateExtent(olMap().getSize());
  apply(() => {
    const xml = project().xml;
    let r = root();
    if (!r) r = xml.documentElement.appendChild(xml.createElement("Bookmarks"));
    const b = xml.createElement("Bookmark");
    b.setAttribute("id", `{${crypto.randomUUID()}}`);
    b.setAttribute("name", name);
    b.setAttribute("group", group);
    b.setAttribute("rotation", "0");
    b.setAttribute("extent", `Polygon ((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))`);
    const crs = xml.querySelector("qgis > projectCrs > spatialrefsys");
    if (crs) b.appendChild(crs.cloneNode(true));
    r.appendChild(b);
  }, N_("add bookmark"));
}

const bookmarkEl = (id: string) => [...(root()?.children ?? [])].find((b) => b.getAttribute("id") === id);

export function renameBookmark(id: string, name: string) {
  apply(() => bookmarkEl(id)?.setAttribute("name", name), N_("rename bookmark"));
}

export function removeBookmark(id: string) {
  apply(() => bookmarkEl(id)?.remove(), N_("remove bookmark"));
}

/** The bookmark's extent in the project CRS (bookmarks keep the CRS they were made in). */
function inProjectCrs(b: Bookmark): Extent {
  const authid = b.crs && findChild(b.crs, "authid")?.textContent;
  const def = b.crs && findChild(b.crs, "proj4")?.textContent;
  const projectDef = engine().projectVariables()["project_crs_proj4"];
  if (!b.crs || authid === srid() || (def && def === projectDef)) return b.extent;
  const code = authid || `BOOKMARK:${b.id}`;
  if (def && !getProjection(code)) {
    proj4.defs(code, def);
    register(proj4);
  }
  try {
    return transformExtent(b.extent, code, srid());
  } catch {
    const api = engine();
    const r = api.transformRectangle(new api.QgsRectangle(...(b.extent as [number, number, number, number])), code, srid());
    return [r.xMinimum, r.yMinimum, r.xMaximum, r.yMaximum];
  }
}

export function zoomToBookmark(b: Bookmark) {
  olMap().getView().fit(inProjectCrs(b), { duration: 400 });
}
