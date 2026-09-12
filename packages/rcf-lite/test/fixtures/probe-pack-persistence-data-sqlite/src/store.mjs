// Minimal store facade fixture for persistence-data-sqlite probes.
//
// The blueprint requires a single boot-time open entry point that
// runs migrations before returning, exposes typed verbs and never
// leaks the raw handle. This fixture realises that contract with
// node:sqlite (Node 24 built-in). Consumers import openStore only;
// nothing else in the fixture opens the file.

import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSIONS = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            at TEXT NOT NULL
          )`,
  },
];

export const MAX_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1].version;

export function openStore({ path, eventSink }) {
  if (!path) throw new Error('openStore: path is required (configuration-sourced)');
  const emit = typeof eventSink === 'function' ? eventSink : () => {};
  const openedAt = new Date().toISOString();
  const db = new DatabaseSync(path);
  const jmRows = db.prepare('PRAGMA journal_mode=WAL').all();
  const journalMode = String(jmRows[0]?.journal_mode || 'unknown');
  // Set the synchronous commit floor at open time (durability posture
  // owned on AC-5105-3: WAL requires synchronous>=NORMAL for a
  // crash-safe floor). No consumer configures this.
  db.prepare('PRAGMA synchronous=NORMAL').run();
  const syncRows = db.prepare('PRAGMA synchronous').all();
  const synchronousLevel = Number(syncRows[0]?.synchronous ?? -1);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
             version INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL
           )`);
  const appliedRows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  const applied = new Set(appliedRows.map((r) => Number(r.version)));
  const appliedMigrations = [];
  for (const m of SCHEMA_VERSIONS) {
    if (applied.has(m.version)) continue;
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(m.version, new Date().toISOString());
    appliedMigrations.push(m.version);
  }
  emit({ event: 'storeOpened', path, timestamp: openedAt, appliedMigrations });

  return {
    openedAt,
    appliedMigrations,
    journalMode,
    synchronousLevel,
    schemaVersion() {
      const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
      return Number(row.v || 0);
    },
    journalModeNow() {
      const rows = db.prepare('PRAGMA journal_mode').all();
      return String(rows[0]?.journal_mode || 'unknown');
    },
    synchronousNow() {
      const rows = db.prepare('PRAGMA synchronous').all();
      return Number(rows[0]?.synchronous ?? -1);
    },
    put(key, value) {
      const at = new Date().toISOString();
      const info = db.prepare(
        'INSERT INTO entries(key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ).run(String(key), String(value), at);
      const row = db.prepare('SELECT id FROM entries WHERE key=?').get(String(key));
      emit({ event: 'entryPut', key: String(key), size: String(value).length, timestamp: at });
      return { rowId: Number(row.id), changes: Number(info.changes) };
    },
    get(key) {
      const row = db.prepare('SELECT id, value FROM entries WHERE key=?').get(String(key));
      emit({ event: 'entryRead', key: String(key), hit: Boolean(row), timestamp: new Date().toISOString() });
      return row ? { rowId: Number(row.id), value: String(row.value) } : null;
    },
    delete(key) {
      const info = db.prepare('DELETE FROM entries WHERE key=?').run(String(key));
      emit({ event: 'entryDeleted', key: String(key), timestamp: new Date().toISOString() });
      return { changes: Number(info.changes) };
    },
    walCheckpoint(mode = 'TRUNCATE') {
      const rows = db.prepare(`PRAGMA wal_checkpoint(${mode})`).all();
      const [row] = rows;
      const timestamp = new Date().toISOString();
      const result = { busy: Number(row.busy), pagesLog: Number(row.log), pagesCheckpointed: Number(row.checkpointed) };
      emit({ event: 'walCheckpoint', mode, ...result, timestamp });
      return result;
    },
    close() {
      db.close();
      emit({ event: 'storeClosed', timestamp: new Date().toISOString() });
    },
  };
}
