import type { QgsVectorLayer } from "qgis-js";
import { engine, exists, findMapLayer, free, readFile, writeFile } from "./engine";
import { insertLayerXml, project } from "./doc";
import { mapLayerXml } from "./adddata";
import { crsByAuthid } from "./crs";
import { openGpkg, writeGpkgTable, type NewTable } from "./gpkg";
import { rows } from "./sqlite";
import { apply } from "./commit";
import { ui } from "./state.svelte";

/**
 * Processing algorithms, modelled on QGIS's native provider (same ids, parameters and defaults).
 * Geometry operations run in GEOS — the library QGIS's native algorithms call — compiled to
 * WebAssembly; features and expressions come from the QGIS engine.
 */

type Geos = Awaited<ReturnType<typeof import("geos-wasm").default>>;
let geosPromise: Promise<Geos> | null = null;
const getGeos = () => (geosPromise ??= import("geos-wasm").then((m) => m.default()));
export const geosOps = async () => new GeosOps(await getGeos());

export type ParamType = "layer" | "layers" | "number" | "string" | "enum" | "field" | "crs" | "bool" | "expression";
export interface Param {
  name: string;
  label: string;
  type: ParamType;
  default?: unknown;
  options?: string[];
  /** For layer params: restrict to a geometry family. */
  geometry?: "point" | "line" | "polygon";
  optional?: boolean;
  /** For field params: the layer param the field belongs to. */
  parent?: string;
}

interface Feature { wkb: Uint8Array | null; attrs: unknown[]; fid?: number }
interface Input { name: string; crs: string; fields: { name: string; type: number }[]; features: Feature[] }

export interface Algorithm {
  id: string;
  name: string;
  group: string;
  description: string;
  params: Param[];
  run(p: Record<string, unknown>, g: GeosOps, read: (id: string, opts?: { crs?: string; expression?: string }) => Input): Promise<Output> | Output;
}

interface Output { name: string; crs: string; fields: { name: string; type: number }[]; features: Feature[] }

// ---- GEOS helpers -------------------------------------------------------------------------

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

export class GeosOps {
  private reader: number;
  private writer: number;
  constructor(public geos: Geos) {
    this.reader = geos.GEOSWKBReader_create();
    this.writer = geos.GEOSWKBWriter_create();
    geos.GEOSWKBWriter_setOutputDimension(this.writer, 2);
  }

  read(wkb: Uint8Array): number {
    const s = hex(wkb);
    const ptr = this.geos.Module._malloc(s.length + 1);
    this.geos.Module.stringToUTF8(s, ptr, s.length + 1);
    const g = this.geos.GEOSWKBReader_readHEX(this.reader, ptr, s.length);
    this.geos.Module._free(ptr);
    return g;
  }

  /** WKB of a GEOS geometry; destroys it. */
  write(g: number): Uint8Array | null {
    if (!g) return null;
    if (this.geos.GEOSisEmpty(g)) {
      this.geos.GEOSGeom_destroy(g);
      return null;
    }
    const size = this.geos.Module._malloc(8);
    const p = this.geos.GEOSWKBWriter_writeHEX(this.writer, g, size);
    // The hex string isn't NUL-terminated: keep exactly the reported number of characters.
    const s = this.geos.Module.UTF8ToString(p).slice(0, this.geos.Module.getValue(size, "i32"));
    this.geos.GEOSFree(p);
    this.geos.Module._free(size);
    this.geos.GEOSGeom_destroy(g);
    return unhex(s);
  }

  /** Applies a unary GEOS operation to a WKB geometry. */
  unary(wkb: Uint8Array | null, op: (g: number) => number) {
    if (!wkb) return null;
    const g = this.read(wkb);
    const out = op(g);
    this.geos.GEOSGeom_destroy(g);
    return this.write(out);
  }

  /** Planar length of a geometry. */
  length(g: number) {
    const p = this.geos.Module._malloc(8);
    this.geos.GEOSLength(g, p);
    const v = this.geos.Module.getValue(p, "double");
    this.geos.Module._free(p);
    return v;
  }

  /** Coordinates of a point geometry. */
  xy(g: number): [number, number] {
    const p = this.geos.Module._malloc(8);
    this.geos.GEOSGeomGetX(g, p);
    const x = this.geos.Module.getValue(p, "double");
    this.geos.GEOSGeomGetY(g, p);
    const y = this.geos.Module.getValue(p, "double");
    this.geos.Module._free(p);
    return [x, y];
  }

  /** Polygons formed by a set of lines (GEOSPolygonize takes an array of geometry pointers). */
  polygonize(lines: number) {
    const arr = this.geos.Module._malloc(4);
    // Emscripten's setValue(ptr, value, type); the bundled typings declare another order.
    (this.geos.Module.setValue as unknown as (ptr: number, value: number, type: string) => void)(arr, lines, "i32");
    const out = this.geos.GEOSPolygonize(arr, 1);
    this.geos.Module._free(arr);
    return out;
  }

  /**
   * The parts of a geometry of one family (1 point, 2 line, 3 polygon), as a multi geometry
   * (or null); destroys the geometry. Overlay results can be collections of mixed types.
   */
  ofFamily(g: number, family: number): Uint8Array | null {
    const wkb = this.write(g);
    if (!wkb) return null;
    const fam = (b: Uint8Array) => ((typeCode(b) - 1) % 3) + 1;
    const t = typeCode(wkb);
    if (t !== 7) return t >= 1 && t <= 6 && fam(wkb) === family ? toMulti(wkb) : null;
    const c = this.read(wkb);
    const parts = this.parts(c).filter((p) => typeCode(p) >= 1 && typeCode(p) <= 6 && fam(p) === family);
    this.geos.GEOSGeom_destroy(c);
    return parts.length ? toMulti(this.union(parts)) : null;
  }

  polygonal = (g: number) => this.ofFamily(g, 3);

  /** The parts of a geometry, as new geometries (WKB). */
  parts(g: number): Uint8Array[] {
    const n = this.geos.GEOSGetNumGeometries(g);
    return Array.from({ length: n }, (_, i) => this.write(this.geos.GEOSGeom_clone(this.geos.GEOSGetGeometryN(g, i)))!).filter(Boolean);
  }

  /** Union of many WKB geometries. */
  union(wkbs: (Uint8Array | null)[]) {
    const parts = wkbs.filter((w): w is Uint8Array => !!w);
    if (!parts.length) return null;
    // A geometry collection of all parts, unioned at once (cascaded), as QGIS's dissolve does.
    const collection = new Uint8Array(9 + parts.reduce((n, p) => n + p.length, 0));
    const v = new DataView(collection.buffer);
    v.setUint8(0, 1);
    v.setUint32(1, 7, true);
    v.setUint32(5, parts.length, true);
    let o = 9;
    for (const p of parts) collection.set(p, o), (o += p.length);
    return this.unary(collection, (g) => this.geos.GEOSUnaryUnion(g));
  }
}

/** Promotes single-part WKB (Point/LineString/Polygon) to its multi type, as QGIS outputs. */
export function toMulti(wkb: Uint8Array | null) {
  if (!wkb) return null;
  const type = new DataView(wkb.buffer, wkb.byteOffset).getUint32(1, wkb[0] === 1);
  if (type < 1 || type > 3) return wkb;
  const out = new Uint8Array(9 + wkb.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, type + 3, true);
  v.setUint32(5, 1, true);
  out.set(wkb, 9);
  return out;
}

/** WKB of a 2D point. */
export function pointWkb(x: number, y: number) {
  const b = new DataView(new ArrayBuffer(21));
  b.setUint8(0, 1);
  b.setUint32(1, 1, true);
  b.setFloat64(5, x, true);
  b.setFloat64(13, y, true);
  return new Uint8Array(b.buffer);
}

/** Field lists of two layers combined, suffixing clashing names (case-insensitive) as QGIS does. */
function combineFields(a: Input["fields"], b: Input["fields"], prefix = "") {
  const names = new Set(a.map((f) => f.name.toLowerCase()));
  const unique = (n: string) => {
    let name = prefix + n;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${prefix}${n}_${i}`;
    names.add(name.toLowerCase());
    return name;
  };
  return [...a, ...b.map((f) => ({ ...f, name: unique(f.name) }))];
}

const typeCode = (wkb: Uint8Array) => new DataView(wkb.buffer, wkb.byteOffset).getUint32(1, wkb[0] === 1) % 1000;

const geomTypeName = (wkb: Uint8Array | null) =>
  wkb ? ["GEOMETRY", "POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION"][new DataView(wkb.buffer, wkb.byteOffset).getUint32(1, wkb[0] === 1) % 1000] ?? "GEOMETRY" : "GEOMETRY";

// ---- Algorithms ----------------------------------------------------------------------------

const CAP = ["Round", "Flat", "Square"];
const JOIN = ["Round", "Miter", "Bevel"];
const input = (geometry?: Param["geometry"]): Param => ({ name: "INPUT", label: "Input layer", type: "layer", geometry });
const overlay: Param = { name: "OVERLAY", label: "Overlay layer", type: "layer", geometry: "polygon" };

const perFeature = (r: Input, f: (wkb: Uint8Array | null) => Uint8Array | null, multi = true): Output => ({
  ...r,
  features: r.features.map((x) => ({ wkb: multi ? toMulti(f(x.wkb)) : f(x.wkb), attrs: x.attrs })).filter((x) => x.wkb),
});

/** Geometry family of a WKB (1 point, 2 line, 3 polygon). */
const familyOf = (wkb: Uint8Array) => ((typeCode(wkb) - 1) % 3) + 1;

export const ALGORITHMS: Algorithm[] = [
  {
    id: "native:buffer",
    name: "Buffer",
    group: "Vector geometry",
    description: "Computes a buffer area for all features at a fixed distance (in layer units).",
    params: [
      input(),
      { name: "DISTANCE", label: "Distance (layer units)", type: "number", default: 10 },
      { name: "SEGMENTS", label: "Segments", type: "number", default: 5 },
      { name: "END_CAP_STYLE", label: "End cap style", type: "enum", options: CAP, default: 0 },
      { name: "JOIN_STYLE", label: "Join style", type: "enum", options: JOIN, default: 0 },
      { name: "MITER_LIMIT", label: "Miter limit", type: "number", default: 2 },
      { name: "DISSOLVE", label: "Dissolve result", type: "bool", default: false },
    ],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const out = perFeature(r, (w) => g.unary(w, (x) => g.geos.GEOSBufferWithStyle(x, +p.DISTANCE!, +p.SEGMENTS!, +p.END_CAP_STYLE! + 1, +p.JOIN_STYLE! + 1, +p.MITER_LIMIT!)));
      return p.DISSOLVE ? { ...out, fields: [], features: [{ wkb: toMulti(g.union(out.features.map((f) => f.wkb))), attrs: [] }] } : out;
    },
  },
  {
    id: "native:centroids",
    name: "Centroids",
    group: "Vector geometry",
    description: "Creates a point at the centroid of each feature.",
    params: [input(), { name: "ALL_PARTS", label: "Create centroid for each part", type: "bool", default: false }],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSGetCentroid(x)), false),
  },
  {
    id: "native:pointonsurface",
    name: "Point on surface",
    group: "Vector geometry",
    description: "Creates a point guaranteed to lie on the surface of each feature.",
    params: [input()],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSPointOnSurface(x)), false),
  },
  {
    id: "native:convexhull",
    name: "Convex hull",
    group: "Vector geometry",
    description: "Calculates the convex hull of each feature.",
    params: [input()],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSConvexHull(x))),
  },
  {
    id: "native:boundingboxes",
    name: "Bounding boxes",
    group: "Vector geometry",
    description: "Calculates the bounding box (envelope) of each feature.",
    params: [input()],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSEnvelope(x))),
  },
  {
    id: "native:simplifygeometries",
    name: "Simplify",
    group: "Vector geometry",
    description: "Simplifies geometries (Douglas-Peucker, topology preserving) with a tolerance in layer units.",
    params: [input(), { name: "TOLERANCE", label: "Tolerance (layer units)", type: "number", default: 1 }],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSTopologyPreserveSimplify(x, +p.TOLERANCE!))),
  },
  {
    id: "native:fixgeometries",
    name: "Fix geometries",
    group: "Vector geometry",
    description: "Creates a valid representation of invalid geometries (GEOS MakeValid).",
    params: [input()],
    run: (p, g, read) => perFeature(read(p.INPUT as string), (w) => g.unary(w, (x) => g.geos.GEOSMakeValid(x))),
  },
  {
    id: "native:dissolve",
    name: "Dissolve",
    group: "Vector geometry",
    description: "Combines features into new features, optionally grouped by a field.",
    params: [input(), { name: "FIELD", label: "Dissolve field (optional)", type: "field", parent: "INPUT", optional: true }],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const idx = r.fields.findIndex((f) => f.name === p.FIELD);
      const groups = new Map<unknown, Feature[]>();
      for (const f of r.features) {
        const key = idx < 0 ? "" : f.attrs[idx];
        groups.set(key, [...(groups.get(key) ?? []), f]);
      }
      return { ...r, features: [...groups.values()].map((fs) => ({ wkb: toMulti(g.union(fs.map((f) => f.wkb))), attrs: fs[0].attrs })) };
    },
  },
  {
    id: "native:clip",
    name: "Clip",
    group: "Vector overlay",
    description: "Clips a layer using the polygons of an overlay layer; attributes are not changed.",
    params: [input(), overlay],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const mask = g.union(read(p.OVERLAY as string, { crs: r.crs }).features.map((f) => f.wkb));
      if (!mask) return { ...r, features: [] };
      const m = g.read(mask);
      const prepared = g.geos.GEOSPrepare(m);
      const out = perFeature(r, (w) => {
        if (!w) return null;
        const x = g.read(w);
        const hit = g.geos.GEOSPreparedIntersects(prepared, x);
        const res = hit ? g.geos.GEOSIntersection(x, m) : 0;
        g.geos.GEOSGeom_destroy(x);
        return res ? g.ofFamily(res, familyOf(w)) : null;
      });
      g.geos.GEOSPreparedGeom_destroy(prepared);
      g.geos.GEOSGeom_destroy(m);
      return out;
    },
  },
  {
    id: "native:difference",
    name: "Difference",
    group: "Vector overlay",
    description: "Keeps the parts of input features that fall outside the overlay polygons.",
    params: [input(), overlay],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const mask = g.union(read(p.OVERLAY as string, { crs: r.crs }).features.map((f) => f.wkb));
      if (!mask) return r;
      const m = g.read(mask);
      const out = perFeature(r, (w) => {
        if (!w) return null;
        const x = g.read(w);
        const res = g.geos.GEOSDifference(x, m);
        g.geos.GEOSGeom_destroy(x);
        return g.ofFamily(res, familyOf(w));
      });
      g.geos.GEOSGeom_destroy(m);
      return out;
    },
  },
  {
    id: "native:intersection",
    name: "Intersection",
    group: "Vector overlay",
    description: "Extracts the overlapping parts of features, with attributes of both layers.",
    params: [input(), overlay],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const o = read(p.OVERLAY as string, { crs: r.crs });
      const overlays = o.features.filter((f) => f.wkb).map((f) => ({ g: g.read(f.wkb!), attrs: f.attrs }));
      const features: Feature[] = [];
      for (const f of r.features) {
        if (!f.wkb) continue;
        const x = g.read(f.wkb);
        for (const ov of overlays) {
          if (!g.geos.GEOSIntersects(x, ov.g)) continue;
          const wkb = g.ofFamily(g.geos.GEOSIntersection(x, ov.g), familyOf(f.wkb));
          if (wkb) features.push({ wkb, attrs: [...f.attrs, ...ov.attrs] });
        }
        g.geos.GEOSGeom_destroy(x);
      }
      overlays.forEach((ov) => g.geos.GEOSGeom_destroy(ov.g));
      // Column names are case-insensitive in GeoPackage: suffix overlay fields that clash, as QGIS does.
      const names = new Set(r.fields.map((f) => f.name.toLowerCase()));
      const unique = (n: string) => {
        let name = n;
        for (let i = 2; names.has(name.toLowerCase()); i++) name = `${n}_${i}`;
        names.add(name.toLowerCase());
        return name;
      };
      return { ...r, fields: [...r.fields, ...o.fields.map((f) => ({ ...f, name: unique(f.name) }))], features };
    },
  },
  {
    id: "native:union",
    name: "Union",
    group: "Vector overlay",
    description: "Overlays two layers: overlapping parts carry attributes of both, the rest keep their own.",
    params: [input("polygon"), overlay],
    run(p, g, read) {
      const a = read(p.INPUT as string);
      const b = read(p.OVERLAY as string, { crs: a.crs });
      const nullsA = a.fields.map(() => null), nullsB = b.fields.map(() => null);
      const A = a.features.filter((f) => f.wkb).map((f) => ({ g: g.read(f.wkb!), attrs: f.attrs }));
      const B = b.features.filter((f) => f.wkb).map((f) => ({ g: g.read(f.wkb!), attrs: f.attrs }));
      const features: Feature[] = [];
      // Overlay results can be collections (polygons plus touching lines/points): keep the polygons.
      const push = (geom: number, attrs: unknown[]) => {
        const wkb = g.polygonal(geom);
        if (wkb) features.push({ wkb, attrs });
      };
      const unionOf = (list: { g: number }[]) => g.union(list.map((x) => g.write(g.geos.GEOSGeom_clone(x.g))));
      const allA = unionOf(A), allB = unionOf(B);
      const uA = allA ? g.read(allA) : 0, uB = allB ? g.read(allB) : 0;
      for (const fa of A) {
        for (const fb of B) if (g.geos.GEOSIntersects(fa.g, fb.g)) push(g.geos.GEOSIntersection(fa.g, fb.g), [...fa.attrs, ...fb.attrs]);
        push(uB ? g.geos.GEOSDifference(fa.g, uB) : g.geos.GEOSGeom_clone(fa.g), [...fa.attrs, ...nullsB]);
      }
      for (const fb of B) push(uA ? g.geos.GEOSDifference(fb.g, uA) : g.geos.GEOSGeom_clone(fb.g), [...nullsA, ...fb.attrs]);
      [...A, ...B].forEach((x) => g.geos.GEOSGeom_destroy(x.g));
      if (uA) g.geos.GEOSGeom_destroy(uA);
      if (uB) g.geos.GEOSGeom_destroy(uB);
      return { ...a, fields: combineFields(a.fields, b.fields), features };
    },
  },
  {
    id: "native:joinattributesbylocation",
    name: "Join attributes by location",
    group: "Vector general",
    description: "Adds the attributes of features of another layer that match spatially (one-to-one: the first match).",
    params: [
      input(),
      { name: "JOIN", label: "Join layer", type: "layer" },
      { name: "PREDICATE", label: "Where the features", type: "enum", options: ["intersect", "contain", "are within"], default: 0 },
      { name: "METHOD", label: "Join type", type: "enum", options: ["One-to-many (a feature per match)", "One-to-one (first match only)"], default: 1 },
      { name: "DISCARD_NONMATCHING", label: "Discard features without a match", type: "bool", default: false },
      { name: "PREFIX", label: "Joined field prefix", type: "string", default: "" },
    ],
    run(p, g, read) {
      const a = read(p.INPUT as string);
      const b = read(p.JOIN as string, { crs: a.crs });
      const J = b.features.filter((f) => f.wkb).map((f) => ({ g: g.read(f.wkb!), attrs: f.attrs }));
      const test = [g.geos.GEOSIntersects, g.geos.GEOSContains, g.geos.GEOSWithin][+p.PREDICATE!].bind(g.geos);
      const features: Feature[] = [];
      for (const f of a.features) {
        const x = f.wkb ? g.read(f.wkb) : 0;
        const matches = x ? J.filter((j) => test(x, j.g) === 1) : [];
        if (x) g.geos.GEOSGeom_destroy(x);
        if (!matches.length) {
          if (!p.DISCARD_NONMATCHING) features.push({ ...f, attrs: [...f.attrs, ...b.fields.map(() => null)] });
          continue;
        }
        for (const m of +p.METHOD! === 1 ? matches.slice(0, 1) : matches) features.push({ ...f, attrs: [...f.attrs, ...m.attrs] });
      }
      J.forEach((j) => g.geos.GEOSGeom_destroy(j.g));
      return { ...a, fields: combineFields(a.fields, b.fields, String(p.PREFIX ?? "")), features };
    },
  },
  {
    id: "native:mergevectorlayers",
    name: "Merge vector layers",
    group: "Vector general",
    description: "Combines layers into one (in the first layer's CRS); adds layer and path fields as QGIS does.",
    params: [{ name: "LAYERS", label: "Input layers", type: "layers" }],
    run(p, _g, read) {
      const ids = (p.LAYERS as string[]) ?? [];
      if (ids.length < 2) throw new Error("Choose at least two layers");
      const first = read(ids[0]);
      const inputs = [first, ...ids.slice(1).map((id) => read(id, { crs: first.crs }))];
      const fields: Input["fields"] = [];
      for (const i of inputs) for (const f of i.fields) if (!fields.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) fields.push(f);
      fields.push({ name: "layer", type: 10 }, { name: "path", type: 10 });
      const features = inputs.flatMap((i, k) =>
        i.features.map((f) => ({
          wkb: f.wkb,
          attrs: [...fields.slice(0, -2).map((fd) => {
            const at = i.fields.findIndex((x) => x.name.toLowerCase() === fd.name.toLowerCase());
            return at < 0 ? null : f.attrs[at];
          }), i.name, ids[k]],
        })),
      );
      return { name: "Merged", crs: first.crs, fields, features };
    },
  },
  {
    id: "native:pointsalonglines",
    name: "Points along geometry",
    group: "Vector geometry",
    description: "Creates points at regular distances along lines (and polygon boundaries), with distance and angle.",
    params: [input(), { name: "DISTANCE", label: "Distance (layer units)", type: "number", default: 1 }, { name: "START_OFFSET", label: "Start offset", type: "number", default: 0 }, { name: "END_OFFSET", label: "End offset", type: "number", default: 0 }],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const step = +p.DISTANCE!;
      if (!(step > 0)) throw new Error("The distance must be positive");
      const features: Feature[] = [];
      for (const f of r.features) {
        if (!f.wkb) continue;
        let line = g.read(f.wkb);
        if ([3, 6].includes(typeCode(f.wkb))) {
          const b = g.geos.GEOSBoundary(line);
          g.geos.GEOSGeom_destroy(line);
          line = b;
        }
        const len = g.length(line);
        for (let d = +p.START_OFFSET! || 0; d <= len - (+p.END_OFFSET! || 0) + 1e-9; d += step) {
          const pt = g.geos.GEOSInterpolate(line, d);
          const [x, y] = g.xy(pt);
          g.geos.GEOSGeom_destroy(pt);
          // Angle (degrees clockwise from north) of the line at this point.
          const a0 = g.geos.GEOSInterpolate(line, Math.max(0, d - step * 1e-4)), a1 = g.geos.GEOSInterpolate(line, Math.min(len, d + step * 1e-4));
          const [x0, y0] = g.xy(a0), [x1, y1] = g.xy(a1);
          g.geos.GEOSGeom_destroy(a0);
          g.geos.GEOSGeom_destroy(a1);
          const angle = ((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI + 360) % 360;
          features.push({ wkb: pointWkb(x, y), attrs: [...f.attrs, d, angle] });
        }
        g.geos.GEOSGeom_destroy(line);
      }
      return { ...r, fields: [...r.fields, { name: "distance", type: 6 }, { name: "angle", type: 6 }], features };
    },
  },
  {
    id: "native:extractbyexpression",
    name: "Extract by expression",
    group: "Vector selection",
    description: "Creates a layer with the features matching a QGIS expression (evaluated by QGIS).",
    params: [input(), { name: "EXPRESSION", label: "Expression", type: "expression", parent: "INPUT", default: "" }],
    run: (p, _g, read) => read(p.INPUT as string, { expression: p.EXPRESSION as string }),
  },
  {
    id: "native:extractbylocation",
    name: "Extract by location",
    group: "Vector selection",
    description: "Creates a layer with the features that intersect features of another layer.",
    params: [input(), { name: "INTERSECT", label: "Where the features intersect", type: "layer" }],
    run(p, g, read) {
      const r = read(p.INPUT as string);
      const mask = g.union(read(p.INTERSECT as string, { crs: r.crs }).features.map((f) => f.wkb));
      if (!mask) return { ...r, features: [] };
      const m = g.read(mask);
      const prepared = g.geos.GEOSPrepare(m);
      const features = r.features.filter((f) => {
        if (!f.wkb) return false;
        const x = g.read(f.wkb);
        const hit = g.geos.GEOSPreparedIntersects(prepared, x);
        g.geos.GEOSGeom_destroy(x);
        return hit === 1;
      });
      g.geos.GEOSPreparedGeom_destroy(prepared);
      g.geos.GEOSGeom_destroy(m);
      return { ...r, features };
    },
  },
  {
    id: "native:reprojectlayer",
    name: "Reproject layer",
    group: "Vector general",
    description: "Reprojects a layer to another CRS (transformed by QGIS).",
    params: [input(), { name: "TARGET_CRS", label: "Target CRS", type: "crs", default: "EPSG:4326" }],
    run: (p, _g, read) => ({ ...read(p.INPUT as string, { crs: p.TARGET_CRS as string }), crs: p.TARGET_CRS as string }),
  },
];

// ---- Running ---------------------------------------------------------------------------------

const SQL_TYPES: Record<number, NewTable["fields"][number]["type"]> = { 1: "BOOLEAN", 2: "INTEGER", 3: "INTEGER", 4: "INTEGER", 5: "INTEGER", 6: "REAL", 14: "DATE", 16: "DATETIME" };

/** Selected-only runs: the input layer's selection limits the features read (QGIS's checkbox). */
let selectedOnly = false;

/** Reads a layer's features from QGIS (WKB in the layer CRS, or reprojected by QGIS to `crs`). */
function readLayer(id: string, opts: { crs?: string; expression?: string; fids?: number[] } = {}): Input {
  const api = engine();
  const layer = findMapLayer(id) as QgsVectorLayer | null;
  if (!layer) throw new Error("Input layer not found");
  const all = Array.from({ length: layer.fields().count() }, (_, i) => layer.fields().at(i));
  const keep = all.map((f, i) => [f, i] as const).filter(([f]) => f.name().toLowerCase() !== "fid");
  const req = new api.QgsFeatureRequest();
  if (opts.crs && opts.crs !== layer.crs()) req.setDestinationCrs(opts.crs);
  if (opts.expression) req.setFilterExpression(opts.expression);
  const fids = opts.fids ?? (selectedOnly && ui.selection[id]?.length ? ui.selection[id] : null);
  if (fids) req.setFilterFids(fids);
  const it = layer.getFeatures(req);
  const features: Feature[] = [];
  for (let f = it.nextFeature(); f; f = it.nextFeature()) {
    const attrs = f.attributes();
    features.push({ wkb: f.hasGeometry() ? f.geometry().asWkb() : null, attrs: keep.map(([, i]) => attrs[i]), fid: f.id() });
    free(f);
  }
  free(it);
  free(req);
  return { name: layer.name, crs: opts.crs || layer.crs(), fields: keep.map(([f]) => ({ name: f.name(), type: f.type() })), features };
}

export interface HistoryEntry { id: string; name: string; params: Record<string, unknown>; onlySelected: boolean; at: string; features: number; ms: number }

export async function runAlgorithm(alg: Algorithm, params: Record<string, unknown>, onlySelected = false) {
  const ops = new GeosOps(await getGeos());
  const t0 = performance.now();
  selectedOnly = onlySelected;
  let out: Output;
  try {
    out = await alg.run(params, ops, readLayer);
  } finally {
    selectedOnly = false;
  }
  const [org, code] = (out.crs || "EPSG:4326").split(":");
  const d = project();
  const path = `${d.dir}/data/processing.gpkg`;
  const existing = exists(path) ? readFile(path) : null;
  const base = `${alg.id.split(":")[1]}_${out.name}`.replace(/[^\w]+/g, "_").toLowerCase();
  const taken = new Set<string>();
  if (existing) {
    const db = await openGpkg(existing);
    rows<{ table_name: string }>(db, "select table_name from gpkg_contents").forEach((r) => taken.add(r.table_name));
    db.close();
  }
  let table = base;
  for (let i = 2; taken.has(table); i++) table = `${base}_${i}`;
  const bytes = await writeGpkgTable(existing, {
    name: table,
    geometryType: geomTypeName(out.features.find((f) => f.wkb)?.wkb ?? null),
    srs: { organization: org, code: Number(code), definition: "undefined" },
    fields: out.fields.map((f) => ({ name: f.name, type: SQL_TYPES[f.type] ?? "TEXT" })),
    features: out.features.map((f) => ({ geometry: f.wkb, attributes: f.attrs.map((a) => (a instanceof Date ? a.toISOString() : a)) })),
  });
  writeFile(path, bytes);
  const crs = await crsByAuthid(out.crs);
  const name = `${alg.name} – ${out.name}`;
  let id = "";
  apply(() => (id = insertLayerXml(mapLayerXml({ name, datasource: `./data/processing.gpkg|layername=${table}`, type: "vector", provider: "ogr", crs }), name)));
  ui.current = id;
  const result = { features: out.features.length, ms: Math.round(performance.now() - t0), layerId: id };
  ui.processingHistory = [{ id: alg.id, name: alg.name, params, onlySelected, at: new Date().toISOString(), ...result }, ...ui.processingHistory].slice(0, 50);
  return result;
}

/** Feature ids of `layerId` that intersect any feature of `otherId` (select by location). */
export async function intersectingFids(layerId: string, otherId: string) {
  const g = new GeosOps(await getGeos());
  const r = readLayer(layerId);
  const mask = g.union(readLayer(otherId, { crs: r.crs }).features.map((f) => f.wkb));
  if (!mask) return [];
  const m = g.read(mask);
  const prepared = g.geos.GEOSPrepare(m);
  const fids = r.features.filter((f) => {
    if (!f.wkb) return false;
    const x = g.read(f.wkb);
    const hit = g.geos.GEOSPreparedIntersects(prepared, x);
    g.geos.GEOSGeom_destroy(x);
    return hit === 1;
  }).map((f) => f.fid!);
  g.geos.GEOSPreparedGeom_destroy(prepared);
  g.geos.GEOSGeom_destroy(m);
  return fids;
}
