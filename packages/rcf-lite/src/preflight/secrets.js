// Pre-flight credentials side-file (verification-integrity-cluster-spec §4.6).
//
// Credentials NEVER enter the RCF chain: the preflight session captures
// only the env-var NAME the credential lives under, plus a boolean
// snapshot of whether that env var was present at session time. Values
// are read from the shell at test/finalise time; the chain is
// grep-friendly for names and audit-friendly for provenance without
// ever holding a token.
//
// This module owns:
// - the gitignore aggregator entry (`preflightEntry`) the shared 0.6.0
//   `managedGitignoreEntries()` seam consumes to keep the side-file out
//   of the shared repo by default; adding it is exactly the two-line
//   extension the 0.6.0 spec §4.1 D-4 pattern promises;
// - the side-file path helper;
// - the loader/writer/merge helpers, all of which read the shell env
//   var by NAME only and never accept, log, or persist a value.
//
// Redaction discipline (§4.6): every path through this module obeys
// three rules: values are never read into the record (only presence),
// values are never returned to callers (only names + presence booleans),
// and error messages never quote env-var contents.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';

/**
 * The gitignore entry the aggregator consumes. Shape mirrors
 * `identityEntry` (0.6.0 aggregator seam contract). Adding this to
 * `managedGitignoreEntries()` in `../setup/managed-gitignore.js` is the
 * whole extension: one import line, one array entry.
 */
export const preflightEntry = Object.freeze({
  path: '.rcf/preflight-secrets.local.json',
  owner: 'rcf preflight: credential name-metadata (values never enter the chain)',
  since: '0.7.0',
});

const SECRETS_FILE_REL = '.rcf/preflight-secrets.local.json';

/**
 * Absolute path of the side-file for a given project root.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function preflightSecretsPath(projectRoot) {
  return join(projectRoot, '.rcf', 'preflight-secrets.local.json');
}

/**
 * @typedef {object} PreflightSecretEntry
 * @property {string} serviceId      camelCase service id (matches manifest)
 * @property {string} envVarName     name only; never the value
 * @property {boolean} envVarPresentAtSessionTime
 * @property {string} recordedAt     ISO timestamp
 */

/**
 * @typedef {object} PreflightSecretsFile
 * @property {string} note           human-readable header
 * @property {PreflightSecretEntry[]} entries
 */

const FILE_HEADER_NOTE = 'Credential name-metadata only. Values are never written here or into the RCF chain; env vars are read from the shell at runtime.';

/**
 * Load the side-file. Returns an empty file object when the file does
 * not exist. Never throws on missing file; propagates any other read
 * error to the caller.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<PreflightSecretsFile>}
 */
export async function loadPreflightSecretsFile({ projectRoot }) {
  const path = preflightSecretsPath(projectRoot);
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { note: FILE_HEADER_NOTE, entries: [] };
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return { note: FILE_HEADER_NOTE, entries };
}

/**
 * Record credential name-metadata for one service. The env var VALUE is
 * never accepted as input; the loader reads the shell to observe
 * presence and stores the boolean only.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.serviceId
 * @param {string} args.envVarName
 * @param {NodeJS.ProcessEnv} [args.env]  defaults to process.env
 * @param {() => string} [args.now]       defaults to () => new Date().toISOString()
 * @returns {Promise<PreflightSecretEntry>}
 */
export async function recordPreflightSecret({
  projectRoot, serviceId, envVarName, env = process.env, now = () => new Date().toISOString(),
}) {
  if (typeof serviceId !== 'string' || serviceId.length === 0) {
    throw new Error('recordPreflightSecret: serviceId required');
  }
  if (typeof envVarName !== 'string' || envVarName.length === 0) {
    throw new Error('recordPreflightSecret: envVarName required');
  }
  const present = Object.prototype.hasOwnProperty.call(env, envVarName)
    && typeof env[envVarName] === 'string'
    && env[envVarName].length > 0;
  const entry = /** @type {PreflightSecretEntry} */ ({
    serviceId,
    envVarName,
    envVarPresentAtSessionTime: present,
    recordedAt: now(),
  });
  const file = await loadPreflightSecretsFile({ projectRoot });
  const nextEntries = file.entries.filter((e) => e.serviceId !== serviceId);
  nextEntries.push(entry);
  nextEntries.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  const outFile = { note: FILE_HEADER_NOTE, entries: nextEntries };
  const path = preflightSecretsPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  // Deterministic 2-space JSON with trailing newline for editor-friendliness.
  await writeFile(path, `${JSON.stringify(outFile, null, 2)}\n`, 'utf8');
  return entry;
}
