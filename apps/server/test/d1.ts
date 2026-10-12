/** A tiny D1 stand-in over sql.js (real SQLite compiled to WASM), loaded with the real migrations. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

const MIG = join(__dirname, '..', 'migrations');

export async function makeD1(): Promise<D1Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(MIG, f), 'utf8'));
  const conv = (v: unknown) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
  class Stmt {
    constructor(public sql: string, public args: unknown[] = []) {}
    bind(...a: unknown[]) { return new Stmt(this.sql, a); }
    exec(): Record<string, unknown>[] {
      const st = db.prepare(this.sql);
      try {
        if (this.args.length) st.bind(this.args.map(conv) as never);
        const rows: Record<string, unknown>[] = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      } finally { st.free(); }
    }
    async first<T>() { return (this.exec()[0] ?? null) as T | null; }
    async all<T>() { return { results: this.exec() as T[], success: true }; }
    async run() { this.exec(); return { success: true, meta: { changes: db.getRowsModified() } }; }
  }
  return {
    prepare: (s: string) => new Stmt(s),
    batch: async (stmts: Stmt[]) => {
      db.exec('BEGIN');
      try { const r = stmts.map((s) => { s.exec(); return { success: true }; }); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    raw: db,
  } as unknown as D1Database;
}
