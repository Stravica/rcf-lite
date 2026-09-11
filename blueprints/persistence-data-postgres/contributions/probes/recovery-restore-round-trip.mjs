/**
 * Recovery restore round-trip probe.
 *
 * Drives the shipped fixture recovery runner (src/recovery.mjs
 * exportDatabase, TAC-2804) to produce the dump artefact and asserts
 * the runner emits `backupExported` per AC-27105-1. Because pg_dump is
 * not on the host PATH in every CI runner, the probe supplies the
 * runPgDump override on `exportDatabase` that shells out to
 * `docker exec <sourceContainer> pg_dump ...`. The shipped runner is
 * still the code path under test; only the pg_dump invocation is
 * container-hosted.
 *
 * Brings up a second postgres:17-alpine container on a spare port,
 * pipes the artefact through psql into that container (via the same
 * docker exec pattern), and asserts row-count and md5 checksum
 * equality between source and restored databases.
 *
 * Anchors AC-27105-1 (recovery exported, restore round-trips the row
 * set, backupExported event fires).
 *
 * Cleanup: TRUNCATE users on source; stops the restore container and
 * removes its volume; deletes the artefact directory. Every teardown
 * step records its exit status in the report's `teardown` bag; a
 * teardown failure FAILS the verdict per authoring-standard rule 5.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, connectionUrlFromEnv, MissingPostgresHostError } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';
import { exportDatabase } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/recovery.mjs';

export const DECLARED_ENV = Object.freeze([
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_SOURCE_CONTAINER',
  'POSTGRES_RESTORE_CONTAINER',
  'POSTGRES_RESTORE_PORT',
]);

function skipRow(variable) {
  return {
    anchorAcId: null,
    verdict: 'pass',
    detail: `Given a live Postgres containing a small fixture rowset - accountBound: skipped (${variable} unset)`,
    accountBoundSkipped: true,
    reason: `${variable} unset`,
    evidence: { skip: true, reason: `${variable} unset`, envDeclared: [...DECLARED_ENV] },
  };
}

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
const ARTEFACT_DIR = resolve(PROJECT_ROOT, '.rcf/reports/blueprints/persistence-data-postgres/recovery');
const ARTEFACT = resolve(ARTEFACT_DIR, 'backup.sql');
const ARTEFACT_REL = relative(PROJECT_ROOT, ARTEFACT);
// Source container defaults to the fixture's docker-compose service
// name; a CI runner (or a positive-evidence run) may override via
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
  return new Promise((resolveP, reject) => {
    const child = spawn('docker', ['exec', '-i', container, ...cmd]);
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolveP({ stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') });
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

/**
 * Positively assert `container` is absent by asking docker to inspect
 * it. Absent = docker exits non-zero WITH `No such object` on stderr.
 * Any other error (daemon unreachable, permission denied) fails the
 * assertion; the caller can then FAIL the row rather than treat it as
 * "no problem here" (follow-up review recovery finding).
 */
async function assertContainerAbsent(container) {
  try {
    await execFileAsync('docker', ['inspect', container]);
    throw new Error(`container ${container} still exists`);
  } catch (err) {
    if (err && err.stderr && /[Nn]o such object|[Ee]rror: [Nn]o such/i.test(err.stderr)) return { absent: true };
    if (err && err.message && err.message.includes('still exists')) throw err;
    // Unrecognized inspect failure - do NOT treat as absent.
    throw new Error(`docker inspect on ${container} produced an unrecognized error: ${err && (err.stderr || err.message) || 'unknown'}`);
  }
}

async function bringUpRestore() {
  // Pre-run cleanup: remove any prior instance, THEN positively assert
  // the container is gone. If the pre-run rm fails for a reason other
  // than "container did not exist", let the run fail loudly rather
  // than proceed to a `docker run` that would collide.
  try {
    await execFileAsync('docker', ['rm', '-f', RESTORE_CONTAINER]);
  } catch (err) {
    if (!(err && err.stderr && /[Nn]o such container|[Ee]rror: [Nn]o such/i.test(err.stderr))) {
      throw new Error(`pre-run rm of ${RESTORE_CONTAINER} failed and did not name a No-such-container reason: ${err && (err.stderr || err.message) || 'unknown'}`);
    }
  }
  await assertContainerAbsent(RESTORE_CONTAINER);
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

/**
 * Attempt one teardown step; record its outcome on the accumulator.
 * The step is the literal command reported so a reader sees exactly
 * what ran.
 */
async function recordTeardown(accumulator, label, fn) {
  const entry = { step: label, ok: false, exitCode: null, error: null };
  try {
    const out = await fn();
    entry.ok = true;
    entry.exitCode = 0;
    if (out && typeof out === 'object' && 'exitCode' in out) entry.exitCode = out.exitCode;
  } catch (err) {
    entry.error = err && err.message ? err.message : String(err);
    entry.exitCode = err && typeof err.code === 'number' ? err.code : 1;
  }
  accumulator.push(entry);
  return entry;
}

export default async function runProbe() {
  let url;
  try {
    url = connectionUrlFromEnv();
  } catch (err) {
    if (err instanceof MissingPostgresHostError) {
      return {
        results: [skipRow(err.variable)],
        accountBoundSkipped: true,
        reason: `${err.variable} unset`,
        envDeclared: [...DECLARED_ENV],
      };
    }
    throw err;
  }
  const events = [];
  const store = await createStore({
    connectionUrl: url,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  const teardown = [];
  let restoreBrought = false;
  let artefactWritten = false;
  let databaseName = null;
  try {
    databaseName = await store.ready();
    const pool = store.getPool();
    const pidRR = await pool.query('SELECT pg_backend_pid() AS pid, txid_current() AS txid');
    const backendPidSrc = String(pidRR.rows[0].pid);
    const transactionIdSrc = String(pidRR.rows[0].txid);

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

    // Compute source row-count and checksum
    const srcCount = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const srcCk = (await pool.query('SELECT md5(string_agg(name || $1 || email, $2 ORDER BY id))::text AS ck FROM users', ['|', ','])).rows[0].ck;

    // Drive the shipped exportDatabase runner (TAC-2804) with a
    // runPgDump override that shells out to docker exec inside the
    // source container. The shipped runner still writes the artefact
    // and emits backupExported; the probe proves both.
    //
    // Pre-run: assert the destination directory is absent, then create
    // it. If a prior run left a stale artefact, remove it and
    // positively re-check absence. Any failure here (permission
    // denied, filesystem error) fails the row loudly.
    try {
      const preExist = await stat(ARTEFACT_DIR).catch((err) => {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      });
      if (preExist) {
        await rm(ARTEFACT_DIR, { recursive: true, force: true });
        const after = await stat(ARTEFACT_DIR).catch((err) => {
          if (err && err.code === 'ENOENT') return null;
          throw err;
        });
        if (after) throw new Error(`pre-run: destination ${ARTEFACT_REL} still exists after rm -rf`);
      }
    } catch (err) {
      if (!/still exists/.test(err && err.message)) throw new Error(`pre-run destination cleanup failed unrecognizably: ${err && (err.message || String(err))}`);
      throw err;
    }
    await mkdir(ARTEFACT_DIR, { recursive: true });
    const runnerEvents = [];
    const exported = await exportDatabase({
      destination: ARTEFACT,
      onEvent: (e) => runnerEvents.push(e),
      runPgDump: async ({ pgDumpArgs }) => {
        const dump = await dockerExec(SOURCE_CONTAINER, ['pg_dump', '-U', 'rcf', '-d', 'rcf_test', ...pgDumpArgs]);
        return dump.stdout;
      },
    });
    artefactWritten = true;
    const artefactStat = await stat(ARTEFACT);

    // Assert the runner emitted backupExported per AC-27105-1.
    // Sanitize the event's artefactPath (recovery.mjs records it as
    // the absolute destination) to a project-relative path so a
    // machine path does not land in the persisted evidence record.
    const backupEvent = runnerEvents.find((e) => e.event === 'backupExported');
    const backupEventSanitized = backupEvent
      ? { ...backupEvent, artefactPath: relative(PROJECT_ROOT, backupEvent.artefactPath) }
      : null;
    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: (backupEvent && typeof backupEvent.artefactPath === 'string' && typeof backupEvent.completedAt === 'string') ? 'pass' : 'fail',
      detail: backupEvent
        ? `Given a live Postgres containing a small fixture rowset - shipped exportDatabase emitted backupExported with artefactPath=${relative(PROJECT_ROOT, backupEvent.artefactPath)} completedAt=${backupEvent.completedAt}`
        : `Given a live Postgres containing a small fixture rowset - expected backupExported event on the shipped exportDatabase runner; observed events=${runnerEvents.map((e) => e.event).join(',')}`,
      evidence: {
        backendPid: backendPidSrc,
        transactionId: transactionIdSrc,
        databaseName,
        artefactPath: ARTEFACT_REL,
        artefactBytesOnDisk: artefactStat.size,
        bytesReportedByRunner: exported.bytes,
        backupExportedEvent: backupEventSanitized,
      },
    });

    // Bring up restore container
    await bringUpRestore();
    restoreBrought = true;

    // Pipe artefact into psql on restore (the container ships psql).
    await dockerExecStdin(RESTORE_CONTAINER, ['psql', '-U', 'rcf', '-d', 'rcf_test', '-v', 'ON_ERROR_STOP=1'], Buffer.from(await import('node:fs').then((fs) => fs.promises.readFile(ARTEFACT))));

    // Read row-count and checksum on restored via a connection to the
    // restore container's published port. Host is taken from
    // POSTGRES_HOST (the docker host the restore container publishes
    // its port on); no literal host default lives in shipped probe
    // code (maintainer ruling 2026-09-11).
    const dstStore = await createStore({ connectionUrl: `postgres://rcf:${encodeURIComponent('rcf-dev-only')}@${process.env.POSTGRES_HOST}:${RESTORE_PORT}/rcf_test` });
    let dstCount = -1;
    let dstCk = 'unset';
    let backendPidDst = null;
    let transactionIdDst = null;
    try {
      await dstStore.ready();
      const dstPool = dstStore.getPool();
      const pidRD = await dstPool.query('SELECT pg_backend_pid() AS pid, txid_current() AS txid');
      backendPidDst = String(pidRD.rows[0].pid);
      transactionIdDst = String(pidRD.rows[0].txid);
      dstCount = (await dstPool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
      dstCk = (await dstPool.query('SELECT md5(string_agg(name || $1 || email, $2 ORDER BY id))::text AS ck FROM users', ['|', ','])).rows[0].ck;
    } finally {
      await dstStore.close();
    }

    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: srcCount === dstCount ? 'pass' : 'fail',
      detail: `Given a live Postgres containing a small fixture rowset - row-count source=${srcCount} restored=${dstCount}`,
      evidence: { backendPid: backendPidDst, transactionId: transactionIdDst, databaseName, srcCount, dstCount, restoreContainer: RESTORE_CONTAINER, restorePort: RESTORE_PORT },
    });
    results.push({
      anchorAcId: 'AC-27105-1',
      verdict: srcCk === dstCk && srcCk != null ? 'pass' : 'fail',
      detail: `Given a live Postgres containing a small fixture rowset - checksum source=${srcCk} restored=${dstCk}`,
      evidence: { backendPid: backendPidDst, transactionId: transactionIdDst, srcChecksumMd5: srcCk, dstChecksumMd5: dstCk, checksumMatchStatus: (srcCk && dstCk && srcCk === dstCk) ? 'equal' : 'differ' },
    });
  } finally {
    // Teardown, every step recorded. A failure here becomes a FAIL row
    // on the results per authoring-standard rule 5.
    await recordTeardown(teardown, 'TRUNCATE users on source', async () => {
      try {
        await store.getPool().query('TRUNCATE users RESTART IDENTITY');
      } catch (err) {
        // If the source is unreachable the probe still needs the store closed;
        // rethrow so the accumulator records the failure.
        throw err;
      }
    });
    await recordTeardown(teardown, 'close source pool', async () => {
      await store.close();
    });
    if (restoreBrought) {
      await recordTeardown(teardown, `docker rm -f -v ${RESTORE_CONTAINER}`, async () => {
        await execFileAsync('docker', ['rm', '-f', '-v', RESTORE_CONTAINER]);
      });
      // Positively confirm the container is gone. Any inspect outcome
      // other than a "No such object" error fails the step so an
      // unrecognized daemon-side error is not laundered into success.
      await recordTeardown(teardown, `docker inspect ${RESTORE_CONTAINER} (expected: absent)`, async () => {
        await assertContainerAbsent(RESTORE_CONTAINER);
        return { exitCode: 0 };
      });
    }
    if (artefactWritten) {
      await recordTeardown(teardown, `rm -rf ${ARTEFACT_REL}`, async () => {
        await rm(ARTEFACT_DIR, { recursive: true, force: true });
      });
    }
  }
  // Fold teardown outcomes into the result set (authoring-standard rule 5).
  const failedTeardown = teardown.filter((t) => !t.ok);
  // AC-27105-1 states rowset round-trip + backupExported. It does not
  // state scratch-resource teardown, so this row is CONFORMANCE-ONLY:
  // it records the operational teardown of the scratch restore
  // container and artefact so a reader can see the run left no state
  // behind, without claiming the AC's rowset property.
  const AC27105_TEARDOWN_LIMITATION = 'AC-27105-1: Given a live Postgres containing a small fixture rowset, when the shipped recovery runner exports a backup, then backupExported fires with an artefact path and completedAt timestamp and a subsequent restore against a throwaway container yields byte-equal rowset content. Not observed on this row: this row records only the operational teardown (docker rm of the throwaway restore container plus removal of the pg_dump artefact tree) that follows the AC observing rows; the AC observing evidence is on the earlier rows in this same probe.';
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: AC27105_TEARDOWN_LIMITATION,
    verdict: failedTeardown.length === 0 ? 'pass' : 'fail',
    detail: failedTeardown.length === 0
      ? `conformanceOnly (AC-27105-1: Given a live Postgres containing a small fixture) - teardown ok: ${teardown.map((t) => `${t.step} (exit=${t.exitCode})`).join('; ')}`
      : `conformanceOnly (AC-27105-1: Given a live Postgres containing a small fixture) - teardown FAILED (${failedTeardown.length}/${teardown.length}): ${failedTeardown.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
    evidence: { teardown },
  });
  return { results, extra: { teardown, restoreContainer: RESTORE_CONTAINER, restorePort: RESTORE_PORT } };
}
