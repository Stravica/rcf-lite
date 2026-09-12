// In-process mock of the Cloudflare Workers D1 binding surface
// (prepare, bind, run, all, batch). Backed by node:sqlite (Node 24).
// The fixture facade opens ONLY through env[BINDING_NAME] so the
// probes exercise the same 'binding on env' shape the shipped
// blueprint requires.

import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { const s = new Statement(this.db, this.sql); s.params = params; return s; }
  async run() {
    if (process.env.SIMULATE_D1_RATE_LIMIT === 'true') {
      const err = new Error('D1_ERROR: rate limited'); err.status = 429; err.headers = { 'retry-after': '2' }; throw err;
    }
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid || 0) } };
  }
  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { success: true, results: rows };
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row ?? null;
  }
}

export function createD1Binding({ path }) {
  const db = new DatabaseSync(path);
  return {
    prepare(sql) { return new Statement(db, sql); },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async exec(sql) { db.exec(sql); return { success: true }; },
    __closeForFixture() { db.close(); },
  };
}
