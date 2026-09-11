/**
 * Recovery restore round-trip probe.
 *
 * Seeds the running postgres:17-alpine fixture with a small rowset,
 * runs pg_dump via `docker exec` against the source container (pg_dump
 * ships inside the postgres:17-alpine image; on a shipped project the
 * fixture's src/recovery.mjs drives pg_dump on PATH per TAC-2804),
 * brings up a second postgres:17-alpine container on a spare port,
 * pipes the artefact through psql into the second container, and
 * asserts row-count and checksum equality between source and restored
 * databases.
 *
 * Anchors AC-27105-1 (recovery exported, restore round-trips the row
 * set).
 *
 * Cleans up: TRUNCATE users on source; stops the restore container and
 * removes its volume; deletes the artefact file.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, connectionUrlFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
const ARTEFACT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/persistence-data-postgres/recovery');
const ARTEFACT = resolve(ARTEFACT_DIR, 'backup.sql');
const ARTEFACT_REL = relative(PROJECT_ROOT, ARTEFACT);
// Source container defaults to the fixture's docker-compose service
// name; a CI runner (or a hardening dispatch) may override via
// POSTGRES_SOURCE_CONTAINER. Restore container name and port are
// similarly overridable so parallel runs and non-default docker
// networks can pick free ports; both env vars are declared on the
// fixture's Declared env vars table.
const SOURCE_CONTAINER = process.env.POSTGRES_SOURCE_CONTAINER || 'infra-postgres-postgres-1';
const RESTORE_CONTAINER = process.env.POSTGRES_RESTORE_CONTAINER || 'infra-postgres-restore';
const RESTORE_PORT = process.env.POSTGRES_RESTORE_PORT || '55432';

async function dockerExec(container, cmd, opts = {}) {
  return execFileAsync('docker', ['exec', container, ...cmd], { maxBuffer: 64 * 1024 * 1024, ...opts });
}

/**
 * Pipe an in-process buffer into docker exec's stdin. execFile does not
 * accept stdin buffers, so use spawn.
 */
async function dockerExecStdin(container, cmd, stdinBuffer) {
  return new Promise((resolve2, reject) => {
    const child = spawn('docker', ['exec', '-i', container, ...cmd]);
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve2({ stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') });
      reject(new Error(`docker exec exit ${code}: ${Buffer.concat(errChunks).toString('utf8')}`));
    });
    child.stdin.write(stdinBuffer);
    child.stdin.end();
  });
}

async function waitHealthy(container, maxSeconds = 30) {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const r = await execFileAsync('docker', ['inspect', '--format', '{{.State.Health.Status}}', container]);
      const status = r.stdout.trim();
      if (status === 'healthy') return;
    } catch { /* container not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`container ${container} did not become healthy within ${maxSeconds}s`);
}

async function bringUpRestore() {
  // Remove any prior instance
  await execFileAsync('docker', ['rm', '-f', RESTORE_CONTAINER]).catch(() => {});
  await execFileAsync('docker', [
    'run', '-d',
    '--name', RESTORE_CONTAINER,
    '-e', 'POSTGRES_USER=rcf',
    '-e', 'POSTGRES_PASSWORD=rcf-dev-only',
    '-e', 'POSTGRES_DB=rcf_test',
    '-p', `${RESTORE_PORT}:5432`,
    '--health-cmd', 'pg_isready -U rcf -d rcf_test',
    '--health-interval', '2s',
    '--health-retries', '20',
    'postgres:17-alpine',
  ]);
  await waitHealthy(RESTORE_CONTAINER, 30);
}

async function tearDownRestore() {
  await execFileAsync('docker', ['rm', '-f', '-v', RESTORE_CONTAINER]).catch(() => {});
}

export default async function runProbe() {
  const events = [];
  const store = createStore({
    connectionUrl: connectionUrlFromEnv(),
    onEvent: (e) => events.push(e),
  });
  const results = [];
  try {
    await store.ready();
    const pool = store.getPool();

    // Seed a known rowset on the source
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('TRUNCATE users RESTART IDENTITY');
    const seed = [
      ['alice', 'alice@rcf.test'],
      ['bob', 'bob@rcf.test'],
      ['carol', 'carol@rcf.test'],
      ['dan', 'dan@rcf.test'],
      ['eve', 'eve@rcf.test'],
    ];
    for (const [name, email] of seed) {
      await pool.query('INSERT INTO users(name, email) VALUES ($1, $2)', [name, email]);
    }

    // Compute source row-count and checksum (md5 over concatenated name|email ordered by id)
    const srcCount = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const srcCk = (await pool.query('SELECT md5(string_agg(name || $1 || email, $2 ORDER BY id))::text AS ck FROM users', ['|', ','])).rows[0].ck;

    // pg_dump inside the source container to stdout, capture as artefact
    await mkdir(ARTEFACT_DIR, { recursive: true });
    const dump = await dockerExec(SOURCE_CONTAINER, ['pg_dump', '-U', 'rcf', '-d', 'rcf_test', '--no-owner', '--no-acl', '--format=plain']);
    await writeFile(ARTEFACT, dump.stdout, 'utf8');
    const bytes = Buffer.byteLength(dump.stdout, 'utf8');

    // Bring up restore container
    await bringUpRestore();

    // Pipe artefact into psql on restore
    await dockerExecStdin(RESTORE_CONTAINER, ['psql', '-U', 'rcf', '-d', 'rcf_test', '-v', 'ON_ERROR_STOP=1'], Buffer.from(dump.stdout, 'utf8'));

    // Read row-count and checksum on restored
    const dstStore = createStore({ connectionUrl: `postgres://rcf:${encodeURIComponent('rcf-dev-only')}@localhost:${RESTORE_PORT}/rcf_test` });
    let dstCount = -1;
    let dstCk = 'unset';
    try {
      await dstStore.ready();
      const dstPool = dstStore.getPool();
      dstCount = (await dstPool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
      dstCk = (await dstPool.query('SELECT md5(string_agg(name || $1 || email, $2 ORDER BY id))::text AS ck FROM users', ['|', ','])).rows[0].ck;
    } finally {
      await dstStore.close();
    }

    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: bytes > 0 ? 'pass' : 'fail',
      detail: `pg_dump artefact written to ${ARTEFACT_REL} (${bytes} bytes)`,
    });
    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: srcCount === dstCount ? 'pass' : 'fail',
      detail: `row-count source=${srcCount} restored=${dstCount}`,
    });
    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: srcCk === dstCk && srcCk != null ? 'pass' : 'fail',
      detail: `checksum source=${srcCk} restored=${dstCk}`,
    });
  } finally {
    // Cleanup: truncate source, tear down restore, delete artefact
    try { await store.getPool().query('TRUNCATE users RESTART IDENTITY'); } catch { /* ignore */ }
    await store.close();
    await tearDownRestore();
    await rm(ARTEFACT_DIR, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}
