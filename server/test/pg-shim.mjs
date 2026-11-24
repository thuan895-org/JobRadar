// Stands in for the "pg" package: same Pool.query shape, backed by in-memory PGlite.
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
class Pool {
  async query(text, params) {
    if (!params) { const all = await db.exec(text); const last = all.at(-1) ?? { rows: [] }; return { rows: last.rows, rowCount: last.affectedRows ?? last.rows.length }; }
    const r = await db.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }
  on() {}
  async end() {}
}
export default { Pool };
