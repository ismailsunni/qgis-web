/** Delimited text: parsing a preview, guessing geometry columns, and writing QGIS delimitedtext URIs. */

export interface CsvOptions {
  delimiter: string;
  geometry: "xy" | "wkt" | "none";
  x: string;
  y: string;
  wkt: string;
  crs: string;
}

export interface CsvPreview { name: string; columns: string[]; rows: string[][]; guess: CsvOptions }

/** Splits CSV text into rows (quotes and escaped quotes handled), up to `limit` rows. */
export function parseCsv(text: string, delimiter: string, limit = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length && rows.length < limit; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < limit) row.push(cell), rows.push(row);
  return rows;
}

export function detectDelimiter(header: string) {
  return ["\t", ";", "|", ","].map((d) => [d, header.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

const pick = (cols: string[], names: string[]) => cols.find((c) => names.includes(c.toLowerCase().trim())) ?? "";

export function previewCsv(name: string, text: string): CsvPreview {
  const delimiter = detectDelimiter(text.slice(0, text.search(/\r?\n/) >>> 0 || 2000));
  const [columns = [], ...rows] = parseCsv(text, delimiter, 8);
  const x = pick(columns, ["lon", "lng", "long", "longitude", "x", "easting", "xcoord", "x_coord"]);
  const y = pick(columns, ["lat", "latitude", "y", "northing", "ycoord", "y_coord"]);
  const wkt = pick(columns, ["wkt", "geom", "geometry", "the_geom", "shape"]);
  // Projected coordinates rarely fall within ±180/±90.
  const sample = rows.map((r) => [+r[columns.indexOf(x)], +r[columns.indexOf(y)]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const geographic = sample.every(([a, b]) => Math.abs(a) <= 180 && Math.abs(b) <= 90);
  return { name, columns, rows, guess: { delimiter, geometry: x && y ? "xy" : wkt ? "wkt" : "none", x, y, wkt, crs: geographic ? "EPSG:4326" : "" } };
}

/** The QGIS delimitedtext data source for a CSV in the project's data folder. */
export function delimitedTextUri(relPath: string, o: CsvOptions) {
  // QGIS reads the delimiter raw (a percent-encoded one breaks the provider); a tab is written as \t.
  const params = [`type=csv`, `delimiter=${o.delimiter === "\t" ? "\\t" : o.delimiter}`, `detectTypes=yes`, `skipEmptyFields=no`];
  if (o.geometry === "xy") params.push(`xField=${encodeURIComponent(o.x)}`, `yField=${encodeURIComponent(o.y)}`, `crs=${o.crs}`, `spatialIndex=no`);
  else if (o.geometry === "wkt") params.push(`wktField=${encodeURIComponent(o.wkt)}`, `crs=${o.crs}`, `spatialIndex=no`);
  else params.push("geomType=none");
  return `file:${relPath}?${params.join("&")}`;
}

/** Writes spreadsheet rows as CSV text. */
export function toCsv(rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
