/**
 * Bespoke Node migration runner (TAC-2802).
 *
 * Reads numbered forward-only .sql files from the elicited migrations
 * directory (default ./migrations/), applies each inside its own
 * transaction against the elicited connection URL, and tracks applied
 * filenames in a schema_version bookkeeping table it maintains.
 *
 * SIMULATE_MIGRATION_FAILURE=true swaps the second file's body with
 * an intentionally invalid SQL statement so the negative-run probe can
 * assert the runner rolls back the second file's transaction and stops.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectionUrlFromEnv } from './store.mjs';

const { Client } = pg;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const BOOKKEEPING_TABLE = 'schema_version';

export async function applyAll({
  connectionUrl = connectionUrlFromEnv(),
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  onEvent = () => {},
} = {}) {
  const client = new Client({ connectionString: connectionUrl });
  await client.connect();
  const applied = [];
  const failed = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_version (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const existing = await client.query('SELECT filename FROM schema_version');
    const seen = new Set(existing.rows.map((r) => r.filename));
    const entries = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => {
        const na = parseInt(a.split('_', 1)[0], 10);
        const nb = parseInt(b.split('_', 1)[0], 10);
        return na - nb;
      });
    for (const filename of entries) {
      if (seen.has(filename)) continue;
      let body = await readFile(join(migrationsDir, filename), 'utf8');
      if (
        process.env.SIMULATE_MIGRATION_FAILURE === 'true'
        && filename.startsWith('002_')
      ) {
        body = 'THIS IS NOT VALID SQL AND WILL FAIL';
      }
      try {
        await client.query('BEGIN');
        await client.query(body);
        await client.query('INSERT INTO schema_version(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // rollback best-effort
        }
        failed.push({ filename, code: err.code || null, message: err.message });
        onEvent({ event: 'migrationApplyFailed', ts: Date.now(), filename, code: err.code || null });
        throw Object.assign(err, { failingFilename: filename, appliedSoFar: applied });
      }
    }
    onEvent({ event: 'migrationsApplied', ts: Date.now(), applied });
    return { applied, failed };
  } finally {
    await client.end();
  }
}

// Direct CLI invocation
if (import.meta.url === `file://${process.argv[1]}`) {
  applyAll().then((r) => {
    process.stdout.write(JSON.stringify(r) + '\n');
    process.exit(0);
  }).catch((err) => {
    process.stderr.write(`migration failed at ${err.failingFilename || 'unknown'}: ${err.message}\n`);
    process.exit(1);
  });
}
