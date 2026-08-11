// reviewSurface.viewServer manifest reader/writer (spec §3.6).
//
// Writes are atomic (.tmp → rename) and schema-validated before persist,
// mirroring the preflight and intake writers.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { rcfError } from '#core/errors';
import { validateDocument } from '#core/store';

export const DEFAULT_PID_PATH = '.rcf/view-server.pid';

/**
 * The managed-gitignore entry the aggregator consumes (spec §9.3). The
 * pid file and the supervisor log are host-local runtime artefacts; the
 * chain never carries them.
 */
export const viewServerGitignoreEntry = Object.freeze({
  path: '.rcf/view-server.pid',
  owner: 'rcf view --detach (view-server pid file)',
  since: '0.7.0',
});

export const viewServerLogGitignoreEntry = Object.freeze({
  path: '.rcf/view-server.log',
  owner: 'rcf view --detach (supervisor log)',
  since: '0.7.0',
});

/**
 * Read the reviewSurface.viewServer record from the manifest, if any.
 *
 * @param {string} projectRoot
 * @returns {Promise<object|null>}
 */
export async function readViewServerRecord(projectRoot) {
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  try {
    const raw = await readFile(abs, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.reviewSurface?.viewServer ?? null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Persist a reviewSurface.viewServer block onto the manifest.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.record
 * @returns {Promise<{ record: object } | import('#core/errors').RcfError>}
 */
export async function writeViewServerRecord({ projectRoot, record }) {
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  let manifest = {};
  try {
    const raw = await readFile(abs, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const nextManifest = {
    ...manifest,
    reviewSurface: {
      ...(manifest.reviewSurface ?? {}),
      viewServer: record,
    },
  };
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
  if (validation) return validation;
  try {
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, abs);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `view-supervisor: manifest write failed: ${err.message}`,
      filePath: 'rcf/manifest.json',
      stack: err.stack,
    });
  }
  return { record };
}

/**
 * Clear the reviewSurface.viewServer field.
 *
 * @param {string} projectRoot
 * @returns {Promise<void>}
 */
export async function clearViewServerRecord(projectRoot) {
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  let manifest = {};
  try {
    const raw = await readFile(abs, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (!manifest.reviewSurface?.viewServer) return;
  const nextReview = { ...(manifest.reviewSurface ?? {}) };
  delete nextReview.viewServer;
  const nextManifest = { ...manifest, reviewSurface: nextReview };
  // If the reviewSurface object is empty, drop it entirely so validate
  // does not carry an empty object.
  if (Object.keys(nextReview).length === 0) delete nextManifest.reviewSurface;
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, abs);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** Write a pid file at projectRoot/.rcf/view-server.pid. */
export async function writePidFile(projectRoot, pid) {
  const abs = join(projectRoot, DEFAULT_PID_PATH);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, `${pid}\n`, 'utf8');
}

/** Read the pid file, or null when absent. */
export async function readPidFile(projectRoot) {
  const abs = join(projectRoot, DEFAULT_PID_PATH);
  if (!existsSync(abs)) return null;
  try {
    const raw = await readFile(abs, 'utf8');
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remove the pid file, ignoring ENOENT. */
export async function removePidFile(projectRoot) {
  const abs = join(projectRoot, DEFAULT_PID_PATH);
  try {
    await unlink(abs);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Probe whether a pid is alive. `process.kill(pid, 0)` is the standard
 * cross-platform (POSIX) predicate; throws ESRCH when the process is
 * gone and EPERM when the process exists but the caller lacks permission
 * (still "alive" from our perspective).
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    return false;
  }
}
