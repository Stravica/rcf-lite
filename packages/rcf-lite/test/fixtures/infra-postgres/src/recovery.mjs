/**
 * Scheduled export runner (TAC-2804).
 *
 * Drives pg_dump via child_process.execFile against the elicited
 * connection URL and writes the artefact to the elicited destination.
 * Emits backupExported on the injected event sink.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connectionUrlFromEnv } from './store.mjs';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DESTINATION = resolve(HERE, '..', 'recovery', 'backup.sql');

/**
 * Run pg_dump against connectionUrl and write the artefact to
 * destination via an atomic rename.
 */
export async function exportDatabase({
  connectionUrl = connectionUrlFromEnv(),
  destination = DEFAULT_DESTINATION,
  onEvent = () => {},
  pgDumpArgs = ['--no-owner', '--no-acl', '--format=plain'],
  // Optional escape hatch for probes running the fixture against a
  // Postgres container where pg_dump is not on the host PATH: the
  // caller supplies a function that returns the dump body as a UTF-8
  // string. The shipped default calls pg_dump on PATH unchanged.
  runPgDump = null,
} = {}) {
  await mkdir(dirname(destination), { recursive: true });
  const tmp = `${destination}.tmp-${Date.now()}`;
  let dumpBody;
  if (typeof runPgDump === 'function') {
    dumpBody = await runPgDump({ connectionUrl, pgDumpArgs });
    if (typeof dumpBody !== 'string') {
      throw new Error('runPgDump override must resolve to a UTF-8 string');
    }
  } else {
    const { stdout } = await execFileAsync(
      'pg_dump',
      [connectionUrl, ...pgDumpArgs],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    dumpBody = stdout;
  }
  await writeFile(tmp, dumpBody, 'utf8');
  await rename(tmp, destination);
  const completedAt = new Date().toISOString();
  onEvent({ event: 'backupExported', ts: Date.now(), artefactPath: destination, completedAt });
  return { artefactPath: destination, completedAt, bytes: Buffer.byteLength(dumpBody, 'utf8') };
}

/**
 * Prime a fresh database from an artefact via psql.
 */
export async function restoreDatabase({ connectionUrl, artefactPath }) {
  const body = await readFile(artefactPath, 'utf8');
  const tmp = `${artefactPath}.stdin-${Date.now()}`;
  await writeFile(tmp, body, 'utf8');
  try {
    await execFileAsync('psql', [connectionUrl, '-f', tmp], { maxBuffer: 64 * 1024 * 1024 });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
