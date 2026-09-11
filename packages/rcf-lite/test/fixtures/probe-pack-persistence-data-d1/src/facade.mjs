// D1 persistence facade. Sole reader of env[BINDING_NAME]. Exposes
// named domain verbs; never exports the raw binding or a raw-SQL
// entry point. Applies numbered forward-only migrations in order
// from the fixture's migrations/ directory.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'migrations');
const BINDING_NAME = 'DB';

export async function openFacade({ env, eventSink } = {}) {
  const emit = typeof eventSink === 'function' ? eventSink : () => {};
  const binding = env?.[BINDING_NAME];
  if (!binding) {
    const err = new Error(`d1BindingMissing: env[${BINDING_NAME}] is undefined`);
    err.kind = 'd1BindingMissing';
    err.bindingName = BINDING_NAME;
    throw err;
  }
  await binding.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    ((await binding.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).results || []).map((r) => r.id),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const appliedNow = [];
  for (const f of files) {
    const id = f;
    if (applied.has(id)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
    await binding.exec(sql);
    await binding.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)').bind(id, new Date().toISOString()).run();
    appliedNow.push(id);
  }
  emit({ event: 'facadeReady', migrationsApplied: appliedNow, timestamp: new Date().toISOString() });

  return {
    bindingName: BINDING_NAME,
    migrationsApplied: appliedNow,
    async insertItem({ name, note }) {
      try {
        const res = await binding.prepare('INSERT INTO items(name, note, created_at) VALUES (?, ?, ?)').bind(String(name), String(note ?? ''), new Date().toISOString()).run();
        emit({ event: 'itemInserted', name: String(name), rowId: res.meta.last_row_id, timestamp: new Date().toISOString() });
        return { rowId: res.meta.last_row_id, changes: res.meta.changes };
      } catch (e) {
        if (e.status === 429) {
          const retryAfterMs = Number(e.headers?.['retry-after'] || 1) * 1000;
          emit({ event: 'queryFailed', errorKind: 'rateLimited', retryAfterMs, verb: 'insertItem' });
          const err2 = new Error('d1RateLimited'); err2.kind = 'd1RateLimited'; err2.retryAfterMs = retryAfterMs; throw err2;
        }
        throw e;
      }
    },
    async findItemByName(name) {
      const row = await binding.prepare('SELECT id, name, note FROM items WHERE name = ?').bind(String(name)).first();
      emit({ event: 'itemFetched', name: String(name), hit: Boolean(row), timestamp: new Date().toISOString() });
      return row;
    },
    async listItems() {
      const res = await binding.prepare('SELECT id, name, note FROM items ORDER BY id').all();
      return res.results;
    },
    async deleteItem({ name }) {
      const res = await binding.prepare('DELETE FROM items WHERE name = ?').bind(String(name)).run();
      emit({ event: 'itemDeleted', name: String(name), changes: res.meta.changes, timestamp: new Date().toISOString() });
      return { changes: res.meta.changes };
    },
  };
}

export const D1_BINDING_NAME = BINDING_NAME;
