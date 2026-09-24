// Freeze record I/O (REQ-172; proposal §2.1 v3).
//
// One file: `rcf/define/freeze.json`. Overwritten on every freeze; git
// holds the history. Owned by rcf-lite, outside the shared rcf-schemas
// package until 0.7 (ADR-4121). This module is the seam the freeze
// verb calls in slice 3; the verb itself is not built yet.
//
// A missing file returns `null` (a fresh tree; the delta model treats
// null as unfrozen, proposal §2.2). A malformed file (parse failure,
// or a body that fails the local schema) raises a clear error
// naming the file and the failing field. Silence is never the answer
// to a broken freeze record: the DEFINE gates read this file on every
// invocation and any downstream check would be lying if it kept going.
//
// Local schema (this file, not @stravica-ai/rcf-schemas):
//
//   {
//     frozenAt: ISO-8601 timestamp string,
//     treeHash: "sha256:<64 hex>",
//     docHashes: { <docId>: "sha256:<64 hex>", ... },      // required
//     briefStatements: integer >= 0,                        // required
//     gates:    { [gate]: { state, at, failing?, reason? } }, // optional
//     counts:   { req, us, ac, ... } (open object, integers, optional)
//     litmus:   { attestedAt: string[], readers?: number },  // optional
//     versions: { rcfLite, ruleset, schemas },                // optional
//     note:     string | null,                                // optional
//     override: null | { reason, by, at }                     // required (nullable)
//   }
//
// `override` is required-nullable: the validator throws when the key
// is missing; every writer stamps `override: null` on a fresh freeze.
// The loader tolerates older records that lack the key by defaulting
// to null on read, so a pre-slice-3 freeze.json survives a load
// without a migration step (the next write converges the on-disk
// shape).
//
// The record is EXTENSIBLE: later slices add fields (2 gates the freeze
// verb wrote at freeze time, 4 the `bundle --next` refusal read at
// override time). This slice validates the fields it consumes and
// tolerates the rest; unknown properties survive a load/save
// round-trip so a newer rcf-lite writing the file does not lose them
// to an older reader mid-migration.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Relative path (under the project root) of the freeze record. Used by
 * the walker-invisibility invariant test and by every caller that
 * wants to log the path in an error message.
 */
export const FREEZE_RECORD_REL_PATH = 'rcf/define/freeze.json';

/**
 * Absolute path of the freeze record for a project root.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function freezeRecordPath(projectRoot) {
  return join(projectRoot, FREEZE_RECORD_REL_PATH);
}

/**
 * Structured error thrown on a malformed freeze record. Carries the
 * file path and a short reason. `code` fixes the class so callers can
 * distinguish parse failures from schema failures without matching on
 * the message.
 */
export class FreezeRecordError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.filePath]
   * @param {'parseFailure' | 'schemaFailure' | 'ioFailure'} [opts.code]
   * @param {string} [opts.field]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'FreezeRecordError';
    this.filePath = opts.filePath;
    this.code = opts.code ?? 'schemaFailure';
    this.field = opts.field;
  }
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate the parsed body against the local schema described at the
 * top of this file. Throws `FreezeRecordError` on the first violation
 * (fail fast; the record is one file).
 *
 * @param {unknown} raw
 * @param {string} [filePath]
 * @returns {import('../query/delta.js').FreezeRecord & Record<string, unknown>}
 */
export function validateFreezeRecord(raw, filePath) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FreezeRecordError('Freeze record must be a JSON object.', {
      filePath, field: '(root)',
    });
  }
  const body = /** @type {Record<string, unknown>} */ (raw);
  const require = /** @type {(field: string) => void} */ ((field) => {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      throw new FreezeRecordError(`Freeze record missing required field '${field}'.`, {
        filePath, field,
      });
    }
  });

  require('frozenAt');
  if (typeof body.frozenAt !== 'string' || !ISO_RE.test(body.frozenAt)) {
    throw new FreezeRecordError(
      "Freeze record 'frozenAt' must be an ISO-8601 timestamp string.",
      { filePath, field: 'frozenAt' },
    );
  }

  require('treeHash');
  if (typeof body.treeHash !== 'string' || !SHA256_RE.test(body.treeHash)) {
    throw new FreezeRecordError(
      "Freeze record 'treeHash' must be a 'sha256:<64-hex>' string.",
      { filePath, field: 'treeHash' },
    );
  }

  require('docHashes');
  const docHashes = body.docHashes;
  if (docHashes === null || typeof docHashes !== 'object' || Array.isArray(docHashes)) {
    throw new FreezeRecordError(
      "Freeze record 'docHashes' must be an object mapping ids to sha256:<hex> strings.",
      { filePath, field: 'docHashes' },
    );
  }
  for (const [id, hash] of Object.entries(docHashes)) {
    if (typeof hash !== 'string' || !SHA256_RE.test(hash)) {
      throw new FreezeRecordError(
        `Freeze record docHashes['${id}'] must be a 'sha256:<64-hex>' string.`,
        { filePath, field: `docHashes.${id}` },
      );
    }
  }

  require('briefStatements');
  if (
    typeof body.briefStatements !== 'number'
    || !Number.isInteger(body.briefStatements)
    || body.briefStatements < 0
  ) {
    throw new FreezeRecordError(
      "Freeze record 'briefStatements' must be a non-negative integer.",
      { filePath, field: 'briefStatements' },
    );
  }

  require('override');
  const override = body.override;
  if (override !== null) {
    if (override === undefined || typeof override !== 'object' || Array.isArray(override)) {
      throw new FreezeRecordError(
        "Freeze record 'override' must be null or { reason, by, at }.",
        { filePath, field: 'override' },
      );
    }
    const o = /** @type {Record<string, unknown>} */ (override);
    for (const f of ['reason', 'by', 'at']) {
      if (typeof o[f] !== 'string' || o[f].length === 0) {
        throw new FreezeRecordError(
          `Freeze record 'override.${f}' must be a non-empty string.`,
          { filePath, field: `override.${f}` },
        );
      }
    }
  }

  return /** @type {import('../query/delta.js').FreezeRecord & Record<string, unknown>} */ (body);
}

/**
 * Load and validate the freeze record for a project. Returns null
 * when the file does not exist; throws `FreezeRecordError` on parse
 * or schema failure.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<(import('../query/delta.js').FreezeRecord & Record<string, unknown>) | null>}
 */
export async function loadFreezeRecord({ projectRoot }) {
  const filePath = freezeRecordPath(projectRoot);
  const relPath = FREEZE_RECORD_REL_PATH;
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw new FreezeRecordError(
      `Failed to read ${relPath}: ${/** @type {Error} */ (err).message}`,
      { filePath: relPath, code: 'ioFailure' },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FreezeRecordError(
      `Freeze record parse failed: ${/** @type {Error} */ (err).message}`,
      { filePath: relPath, code: 'parseFailure' },
    );
  }
  // Back-compat: older freeze records were written before override
  // became a required-nullable field. Fill in null on read so a
  // pre-slice-3 record survives; the writer stamps override: null on
  // every fresh freeze so the on-disk shape converges on the current
  // schema without a migration step.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && !Object.prototype.hasOwnProperty.call(parsed, 'override')) {
    /** @type {Record<string, unknown>} */ (parsed).override = null;
  }
  return validateFreezeRecord(parsed, relPath);
}

/**
 * Write the freeze record. Validates first (so a bad in-memory record
 * never lands as JSON on disk), creates `rcf/define/` if needed, and
 * writes pretty-printed JSON with a trailing newline (matches the
 * neighbouring rcf/*.json files' shape).
 *
 * The slice-3 `rcf define freeze` verb is the intended caller; this
 * slice exposes the writer so that verb can be built without another
 * refactor. Every direct caller is expected to have run
 * `computeReadiness` first and only write when the tree is freezeable.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('../query/delta.js').FreezeRecord & Record<string, unknown>} args.record
 * @returns {Promise<{ filePath: string }>}
 */
export async function saveFreezeRecord({ projectRoot, record }) {
  const validated = validateFreezeRecord(record, FREEZE_RECORD_REL_PATH);
  const filePath = freezeRecordPath(projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return { filePath };
}
