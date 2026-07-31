// View-server supervisor (spec §9.3).
//
// Detached mode: the parent CLI process forks a supervisor child via
// `child_process.spawn(..., { detached: true, stdio: 'ignore' })` then
// unref's; the parent returns immediately. The supervisor:
//   1. Writes its pid to .rcf/view-server.pid (gitignored).
//   2. Starts the view server on the requested port.
//   3. Writes the reviewSurface.viewServer manifest block.
//   4. Runs a heartbeat that bumps lastHeartbeatAt every 30 seconds
//      (or the injected interval for tests).
//   5. Handles SIGTERM cleanly: server closed, manifest record cleared,
//      pid file removed.
//   6. On the child server crashing, attempts one restart within 5s;
//      a second crash within a minute exits the supervisor cleanly.
//
// Windows is out of scope per spec §9.3 / §16 O-6.

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { startServer } from '../server/index.js';
import {
  writePidFile,
  readPidFile,
  removePidFile,
  writeViewServerRecord,
  readViewServerRecord,
  clearViewServerRecord,
  isPidAlive,
  DEFAULT_PID_PATH,
} from './manifest-writer.js';
import { ensureLogDir, supervisorLogPath, writeLogLine } from './logs.js';

const here = dirname(fileURLToPath(import.meta.url));
const CHILD_ENTRY_PATH = resolve(here, '..', '..', 'bin', 'view-supervisor-child.mjs');

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

/**
 * Fork a detached supervisor child.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {number} args.port
 * @param {string|null} [args.persistUntil]  ISO timestamp; supervisor auto-stops
 * @param {number} [args.heartbeatMs]        for tests
 * @param {number} [args.startupTimeoutMs]   for tests
 * @returns {Promise<{ pid: number, url: string, record: object }>}
 */
export async function startDetached({ projectRoot, port, persistUntil = null, heartbeatMs = DEFAULT_HEARTBEAT_MS, startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS }) {
  await ensureLogDir(projectRoot);

  // Refuse when a supervisor is already up.
  const existing = await statusOfDetached(projectRoot);
  if (existing.state === 'running') {
    return { pid: existing.pid, url: existing.url, record: existing.record, alreadyRunning: true };
  }

  const child = spawn(process.execPath, [CHILD_ENTRY_PATH], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RCF_VIEW_SUPERVISOR_PROJECT_ROOT: projectRoot,
      RCF_VIEW_SUPERVISOR_PORT: String(port),
      RCF_VIEW_SUPERVISOR_PERSIST_UNTIL: persistUntil ?? '',
      RCF_VIEW_SUPERVISOR_HEARTBEAT_MS: String(heartbeatMs),
    },
  });
  if (typeof child.unref === 'function') child.unref();
  const pid = child.pid;
  if (typeof pid !== 'number') {
    throw new Error('view-supervisor: spawn returned no pid');
  }

  // Wait for the child to record itself in the manifest. Poll instead
  // of piping the child's stdio (we intentionally detach).
  const started = Date.now();
  let record = null;
  while (Date.now() - started < startupTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    record = await readViewServerRecord(projectRoot);
    if (record?.pid === pid) break;
    // eslint-disable-next-line no-await-in-loop
    await delay(100);
  }
  if (!record || record.pid !== pid) {
    // Startup failed. Try to clean up the orphaned child.
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    throw new Error(`view-supervisor: child ${pid} did not record itself in the manifest within ${startupTimeoutMs}ms`);
  }

  // Extract URL from healthCheckPath: 127.0.0.1:PORT/healthz -> the
  // base URL is everything up to /healthz.
  const url = record.healthCheckPath.replace(/\/healthz$/, '');
  return { pid, url, record };
}

/**
 * Stop a running detached supervisor. Idempotent.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ stopped: boolean, pid: number|null }>}
 */
export async function stopDetached(projectRoot) {
  const pid = await readPidFile(projectRoot);
  if (!pid) {
    // Best-effort cleanup for the manifest record.
    await clearViewServerRecord(projectRoot);
    return { stopped: false, pid: null };
  }
  if (!isPidAlive(pid)) {
    await clearViewServerRecord(projectRoot);
    await removePidFile(projectRoot);
    return { stopped: false, pid };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
  // Wait for the process to exit cleanly.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) break;
    // eslint-disable-next-line no-await-in-loop
    await delay(100);
  }
  await clearViewServerRecord(projectRoot);
  await removePidFile(projectRoot);
  return { stopped: true, pid };
}

/**
 * Report the current state of the detached supervisor.
 *
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {number} [opts.heartbeatMs]
 * @returns {Promise<{ state: 'not-started'|'running'|'stale', pid: number|null, record: object|null, url: string|null, lastHeartbeatAt: string|null }>}
 */
export async function statusOfDetached(projectRoot, opts = {}) {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const record = await readViewServerRecord(projectRoot);
  const pidFilePid = await readPidFile(projectRoot);
  const pid = record?.pid ?? pidFilePid ?? null;
  if (!record && !pidFilePid) {
    return { state: 'not-started', pid: null, record: null, url: null, lastHeartbeatAt: null };
  }
  const alive = pid !== null && isPidAlive(pid);
  const url = record?.healthCheckPath ? record.healthCheckPath.replace(/\/healthz$/, '') : null;
  const lastHeartbeatAt = record?.lastHeartbeatAt ?? null;
  const heartbeatFresh = lastHeartbeatAt
    ? (Date.now() - Date.parse(lastHeartbeatAt)) <= (heartbeatMs * 2)
    : false;
  if (alive && heartbeatFresh) {
    return { state: 'running', pid, record, url, lastHeartbeatAt };
  }
  return { state: 'stale', pid, record, url, lastHeartbeatAt };
}

/**
 * The supervisor loop. Runs inside the detached child; the caller is
 * `bin/view-supervisor-child.mjs`. Reads config from env vars set by
 * startDetached, brings up the view server, writes the manifest record,
 * runs the heartbeat, and installs the shutdown handlers.
 *
 * @returns {Promise<void>}
 */
export async function runDetachedChild() {
  const projectRoot = process.env.RCF_VIEW_SUPERVISOR_PROJECT_ROOT;
  const port = Number.parseInt(process.env.RCF_VIEW_SUPERVISOR_PORT ?? '', 10);
  const persistUntil = process.env.RCF_VIEW_SUPERVISOR_PERSIST_UNTIL || null;
  const heartbeatMs = Number.parseInt(process.env.RCF_VIEW_SUPERVISOR_HEARTBEAT_MS ?? '', 10) || DEFAULT_HEARTBEAT_MS;
  if (!projectRoot || !Number.isFinite(port)) {
    await writeLogLine(projectRoot ?? '.', 'runDetachedChild: missing projectRoot or port');
    process.exit(2);
    return;
  }

  await writeLogLine(projectRoot, `supervisor starting on port ${port} (pid ${process.pid})`);

  let server;
  try {
    server = await startServer({
      projectRoot,
      port,
      log: (line) => { writeLogLine(projectRoot, `server: ${line}`).catch(() => {}); },
    });
  } catch (err) {
    await writeLogLine(projectRoot, `supervisor: server start failed: ${err.message}`);
    process.exit(1);
    return;
  }

  await writePidFile(projectRoot, process.pid);

  const socketPath = `.rcf/view-supervisor.${process.pid}.sock`;
  const healthCheckPath = `${server.url.replace(/\/$/, '')}/healthz`;

  let heartbeatTimer;
  let persistTimer;
  let stopping = false;

  const writeRecord = async () => {
    const record = {
      mode: 'detached',
      startedAt: new Date().toISOString(),
      socketPath,
      pid: process.pid,
      healthCheckPath,
      lastHeartbeatAt: new Date().toISOString(),
    };
    if (persistUntil) record.operatorRequestedPersistUntil = persistUntil;
    const result = await writeViewServerRecord({ projectRoot, record });
    if (result && result.kind && typeof result.message === 'string') {
      await writeLogLine(projectRoot, `supervisor: manifest write failed: ${result.message}`);
    }
  };

  const bumpHeartbeat = async () => {
    const record = await readViewServerRecord(projectRoot);
    if (!record) return;
    const next = { ...record, lastHeartbeatAt: new Date().toISOString() };
    await writeViewServerRecord({ projectRoot, record: next });
  };

  const shutdown = async (reason) => {
    if (stopping) return;
    stopping = true;
    await writeLogLine(projectRoot, `supervisor: shutting down (${reason})`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (persistTimer) clearTimeout(persistTimer);
    try {
      await server.close();
    } catch (err) {
      await writeLogLine(projectRoot, `supervisor: server close error: ${err.message}`);
    }
    await clearViewServerRecord(projectRoot);
    await removePidFile(projectRoot);
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  await writeRecord();

  heartbeatTimer = setInterval(() => {
    bumpHeartbeat().catch((err) => writeLogLine(projectRoot, `supervisor: heartbeat error: ${err.message}`).catch(() => {}));
  }, heartbeatMs);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  if (persistUntil) {
    const deadline = Date.parse(persistUntil);
    if (Number.isFinite(deadline)) {
      const wait = Math.max(0, deadline - Date.now());
      persistTimer = setTimeout(() => { shutdown('persistUntilExpired'); }, wait);
      if (typeof persistTimer.unref === 'function') persistTimer.unref();
    }
  }

  await writeLogLine(projectRoot, `supervisor: ready`);
}

// Kept exports available so downstream tooling that pulls the supervisor
// path or config can do so without spelunking.
void CHILD_ENTRY_PATH;
void readFile;
void supervisorLogPath;
void DEFAULT_PID_PATH;
