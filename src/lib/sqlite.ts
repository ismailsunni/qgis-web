import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let SQL: Promise<SqlJsStatic> | null = null;

/** SQLite (for GeoPackage and QGIS's srs.db), loaded on first use. */
export async function sqlite() {
  SQL ??= initSqlJs({ locateFile: () => wasmUrl });
  return SQL;
}

export async function openDb(bytes: Uint8Array): Promise<Database> {
  return new (await sqlite()).Database(bytes);
}

export function rows<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const out: T[] = [];
  while (stmt.step()) out.push(stmt.getAsObject() as T);
  stmt.free();
  return out;
}
