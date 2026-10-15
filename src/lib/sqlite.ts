import init from "@sqlite.org/sqlite-wasm";

/**
 * SQLite for GeoPackage and QGIS's srs.db: the official WebAssembly build, which (unlike sql.js)
 * includes the R*Tree module GeoPackage spatial indexes need. Loaded on first use.
 */
type Sqlite3 = Awaited<ReturnType<typeof init>>;
let sqlite3: Promise<Sqlite3> | null = null;
const lib = () => (sqlite3 ??= init());

export class Db {
  constructor(private s: Sqlite3, private db: InstanceType<Sqlite3["oo1"]["DB"]>) {}

  run(sql: string, params: unknown[] = []) {
    this.db.exec({ sql, bind: params.length ? (params as never) : undefined });
  }

  rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.exec({ sql, bind: params.length ? (params as never) : undefined, rowMode: "object", returnValue: "resultRows" }) as T[];
  }

  /** Registers a JavaScript function as a deterministic SQL scalar function. */
  fn(name: string, f: (...args: never[]) => unknown) {
    this.db.createFunction({ name, xFunc: (_ctx: number, ...args: unknown[]) => f(...(args as never[])) as never, arity: f.length, deterministic: true });
  }

  export(): Uint8Array {
    return this.s.capi.sqlite3_js_db_export(this.db.pointer!);
  }

  close() {
    this.db.close();
  }
}

export async function openDb(bytes?: Uint8Array): Promise<Db> {
  const s = await lib();
  const db = new s.oo1.DB();
  if (bytes?.length) {
    // In-memory databases can't use WAL; GeoPackages saved by QGIS/GDAL often are in WAL mode.
    // Header bytes 18-19 = 2 mark WAL; 1 is the rollback journal (same data, readable in memory).
    if (bytes[18] === 2 || bytes[19] === 2) {
      bytes = bytes.slice();
      bytes[18] = bytes[19] = 1;
    }
    const p = s.wasm.allocFromTypedArray(bytes);
    const { capi } = s;
    const rc = capi.sqlite3_deserialize(db.pointer!, "main", p, bytes.length, bytes.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
    db.checkRc(rc);
  }
  return new Db(s, db);
}

export const rows = <T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) => db.rows<T>(sql, params);
