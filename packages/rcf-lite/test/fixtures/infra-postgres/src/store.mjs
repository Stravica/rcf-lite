/**
 * Postgres store facade fixture.
 *
 * Realises the persistence-data-postgres blueprint's facade contract
 * (TAC-2801). Sole reader of the pg driver in this fixture; every other
 * module in the fixture that touches Postgres imports this module and
 * calls its named domain verbs.
 *
 * The facade emits lifecycle events on the injected onEvent sink and
 * exposes a transaction helper wrapping BEGIN and COMMIT around a
 * consumer callback with a transactionRolledBack event on the failing
 * statement index.
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Named error kind emitted when POSTGRES_HOST is not set. Probes
 * catch this and convert it to the exact-one-variable
 * accountBoundSkipped row the anatomy asserts on; no literal host
 * default lives in shipped fixture code (Dave ruling 2026-09-11).
 */
export class MissingPostgresHostError extends Error {
  constructor() {
    super('POSTGRES_HOST is not set; set POSTGRES_HOST to a reachable postgres endpoint before invoking connectionUrlFromEnv');
    this.name = 'MissingPostgresHostError';
    this.kind = 'missingPostgresHost';
    this.variable = 'POSTGRES_HOST';
  }
}

/**
 * Build the connection URL from environment defaults. POSTGRES_HOST is
 * a required declared variable with no literal default; when it is
 * unset the helper throws MissingPostgresHostError so consumers can
 * emit the exact-one-variable accountBoundSkipped row rather than a
 * generic driver failure. Password lands as-is; this is a
 * development-only fixture.
 */
export function connectionUrlFromEnv() {
  const host = process.env.POSTGRES_HOST;
  if (!host) throw new MissingPostgresHostError();
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'rcf';
  const password = process.env.POSTGRES_PASSWORD || 'rcf-dev-only';
  const db = process.env.POSTGRES_DB || 'rcf_test';
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

/**
 * Create a store facade over a connection URL. onEvent is a synchronous
 * callback the facade invokes with { event, ... } payloads. poolConfig
 * overrides the pg pool defaults per ADR-2805.
 *
 * facadeReady fires exactly once after the first successful ready-check.
 */
export function createStore({ connectionUrl, onEvent = () => {}, poolConfig = {} }) {
  const pool = new Pool({
    connectionString: connectionUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ...poolConfig,
  });

  let readyFired = false;
  const readyPromise = pool.query('SELECT current_database() AS db').then((r) => {
    if (!readyFired) {
      readyFired = true;
      onEvent({ event: 'facadeReady', ts: Date.now(), databaseName: r.rows[0].db });
    }
    return r.rows[0].db;
  });

  async function withReady(fn) {
    await readyPromise;
    return fn();
  }

  return {
    getPool() {
      return pool;
    },
    ready() {
      return readyPromise;
    },
    async createUser(name, email) {
      return withReady(async () => {
        const r = await pool.query(
          'INSERT INTO users(name, email) VALUES ($1, $2) RETURNING id',
          [name, email],
        );
        return r.rows[0].id;
      });
    },
    async getUserById(id) {
      return withReady(async () => {
        const r = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
        return r.rows[0] || null;
      });
    },
    async listUsers() {
      return withReady(async () => {
        const r = await pool.query('SELECT id, name, email FROM users ORDER BY id');
        return r.rows;
      });
    },
    async countUsers() {
      return withReady(async () => {
        const r = await pool.query('SELECT count(*)::int AS n FROM users');
        return r.rows[0].n;
      });
    },
    /**
     * Transaction helper (TAC-2803). Wraps BEGIN/COMMIT around a
     * callback; issues ROLLBACK on any thrown error and fires
     * transactionRolledBack with the zero-based failing statement index.
     */
    async withTransaction(cb) {
      await readyPromise;
      const client = await pool.connect();
      let stmtIndex = 0;
      try {
        await client.query('BEGIN');
        const tx = {
          async query(sql, params) {
            const idx = stmtIndex++;
            try {
              return await client.query(sql, params);
            } catch (err) {
              err._failingStatementIndex = idx;
              throw err;
            }
          },
        };
        const result = await cb(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best-effort rollback; original error is what carries
        }
        const idx = err && typeof err._failingStatementIndex === 'number'
          ? err._failingStatementIndex
          : Math.max(0, stmtIndex - 1);
        onEvent({
          event: 'transactionRolledBack',
          ts: Date.now(),
          statementIndex: idx,
          code: err && err.code ? err.code : null,
        });
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
