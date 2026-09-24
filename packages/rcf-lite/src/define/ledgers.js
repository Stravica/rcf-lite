// Sidecar ledgers under `rcf/define/` (REQ-173; proposal §2.5, §3.2,
// §8.2 v3).
//
// Four ledgers, each one JSON file, each owned by rcf-lite (local
// schema in this module until schemas 0.7, ADR-4121). Every entry is
// numbered in one sequence per ledger for the life of the project;
// numbers never reset, and are what the freeze record's
// `briefStatements` high-water mark counts against (proposal §2.5).
//
//   rcf/define/brief-ledger.json      D1 brief statements
//   rcf/define/decisions-ledger.json  D7 open / answered decisions
//   rcf/define/concern-ledger.json    D5 (concern, REQ) pair records
//   rcf/define/probe-ledger.json      D6 probe findings
//
// Kinds and fields:
//
//   brief.statements[]      { id, kind, text, source, addedAt, status,
//                             resolvedAt?, resolvedBy? }
//     kind  = capability | constraint | actor | entity | externalSystem
//           | surface | outOfScope | openQuestion | amendment
//
//   decisions.decisions[]   { id, question, options: [{ letter, text }],
//                             default: <letter | null>, blocks, addedAt,
//                             status, answer?, answeredAt? }
//     `decision list` prints the numbered format from #241: one
//     decision per item; options with letters; the default; what it
//     blocks. Slice 2 (Readiness) is the second consumer.
//
//   concerns.concerns[]     { id, concern, reqId, disposition, reason?,
//                             addedAt, status, resolvedAt? }
//     disposition = applied | waived
//
//   probes.probes[]         { id, reqId, finding, severity, addedAt,
//                             status, resolvedAt? }
//     severity = low | medium | high
//
// status on every entry is `open | resolved`. `resolve` flips it to
// resolved and stamps `resolvedAt`; `add` stamps `addedAt` and mints
// the next id (highest current + 1).
//
// Loader returns an empty ledger (`{ statements: [] }` etc.) when the
// file is missing so callers can compose without a per-ledger null
// check; a malformed file raises a clear error like the freeze
// record. Every write goes through the writer, which validates the
// full body first (a bad in-memory record never lands as JSON).

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The four ledger identifiers. Ledger name -> filename convention.
 * These are the values `rcf define ledger <name>` accepts.
 */
export const LEDGER_NAMES = /** @type {const} */ (['brief', 'decisions', 'concerns', 'probes']);

/** @typedef {(typeof LEDGER_NAMES)[number]} LedgerName */

const RELATIVE_DIR = 'rcf/define';

/** Per-ledger config: filename, array key on the body, entry schema. */
const LEDGER_CONFIG = /** @type {const} */ ({
  brief: { file: 'brief-ledger.json', arrayKey: 'statements' },
  decisions: { file: 'decisions-ledger.json', arrayKey: 'decisions' },
  concerns: { file: 'concern-ledger.json', arrayKey: 'concerns' },
  probes: { file: 'probe-ledger.json', arrayKey: 'probes' },
});

export const BRIEF_KINDS = /** @type {const} */ ([
  'capability', 'constraint', 'actor', 'entity', 'externalSystem',
  'surface', 'outOfScope', 'openQuestion', 'amendment',
]);

const CONCERN_DISPOSITIONS = /** @type {const} */ (['applied', 'waived']);
const PROBE_SEVERITIES = /** @type {const} */ (['low', 'medium', 'high']);
const STATUS_VALUES = /** @type {const} */ (['open', 'resolved']);

/**
 * Local relative path of a ledger file (project-root-relative).
 *
 * @param {LedgerName} name
 * @returns {string}
 */
export function ledgerRelPath(name) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new TypeError(`Unknown ledger '${name}'.`);
  return `${RELATIVE_DIR}/${cfg.file}`;
}

/**
 * Absolute path of a ledger file for a project root.
 *
 * @param {string} projectRoot
 * @param {LedgerName} name
 * @returns {string}
 */
export function ledgerPath(projectRoot, name) {
  return join(projectRoot, ledgerRelPath(name));
}

export class LedgerError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.filePath]
   * @param {'parseFailure' | 'schemaFailure' | 'ioFailure' | 'usage'} [opts.code]
   * @param {string} [opts.field]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'LedgerError';
    this.filePath = opts.filePath;
    this.code = opts.code ?? 'schemaFailure';
    this.field = opts.field;
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Empty body for a named ledger (matches the shape a loader returns
 * when the file is missing).
 *
 * @param {LedgerName} name
 * @returns {Record<string, unknown>}
 */
export function emptyLedger(name) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new TypeError(`Unknown ledger '${name}'.`);
  return { [cfg.arrayKey]: [] };
}

/**
 * Validate one entry against its ledger schema. Throws `LedgerError`
 * on the first violation.
 *
 * @param {LedgerName} name
 * @param {unknown} entry
 * @param {string} [filePath]
 * @param {string} [where] path segment for error messages, e.g.
 *   'statements[0]'
 */
function validateEntry(name, entry, filePath, where = 'entry') {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new LedgerError(`${name} ${where} must be an object.`, {
      filePath, field: where,
    });
  }
  const e = /** @type {Record<string, unknown>} */ (entry);

  if (typeof e.id !== 'number' || !Number.isInteger(e.id) || e.id < 1) {
    throw new LedgerError(`${name} ${where}.id must be a positive integer.`, {
      filePath, field: `${where}.id`,
    });
  }
  if (typeof e.addedAt !== 'string' || !ISO_RE.test(e.addedAt)) {
    throw new LedgerError(`${name} ${where}.addedAt must be an ISO-8601 string.`, {
      filePath, field: `${where}.addedAt`,
    });
  }
  if (typeof e.status !== 'string' || !STATUS_VALUES.includes(/** @type {any} */ (e.status))) {
    throw new LedgerError(
      `${name} ${where}.status must be one of: ${STATUS_VALUES.join(', ')}.`,
      { filePath, field: `${where}.status` },
    );
  }
  if (e.status === 'resolved') {
    if (typeof e.resolvedAt !== 'string' || !ISO_RE.test(e.resolvedAt)) {
      throw new LedgerError(
        `${name} ${where}.resolvedAt must be an ISO-8601 string when status is resolved.`,
        { filePath, field: `${where}.resolvedAt` },
      );
    }
  }

  if (name === 'brief') {
    if (typeof e.kind !== 'string' || !BRIEF_KINDS.includes(/** @type {any} */ (e.kind))) {
      throw new LedgerError(
        `brief ${where}.kind must be one of: ${BRIEF_KINDS.join(', ')}.`,
        { filePath, field: `${where}.kind` },
      );
    }
    if (typeof e.text !== 'string' || e.text.length === 0) {
      throw new LedgerError(`brief ${where}.text must be a non-empty string.`, {
        filePath, field: `${where}.text`,
      });
    }
    if (e.source !== undefined && typeof e.source !== 'string') {
      throw new LedgerError(`brief ${where}.source must be a string when present.`, {
        filePath, field: `${where}.source`,
      });
    }
  } else if (name === 'decisions') {
    if (typeof e.question !== 'string' || e.question.length === 0) {
      throw new LedgerError(`decisions ${where}.question must be non-empty.`, {
        filePath, field: `${where}.question`,
      });
    }
    if (!Array.isArray(e.options) || e.options.length === 0) {
      throw new LedgerError(`decisions ${where}.options must be a non-empty array.`, {
        filePath, field: `${where}.options`,
      });
    }
    for (let i = 0; i < e.options.length; i += 1) {
      const opt = e.options[i];
      if (
        opt === null || typeof opt !== 'object' || Array.isArray(opt)
        || typeof (/** @type {any} */ (opt)).letter !== 'string'
        || typeof (/** @type {any} */ (opt)).text !== 'string'
      ) {
        throw new LedgerError(
          `decisions ${where}.options[${i}] must be { letter, text }.`,
          { filePath, field: `${where}.options[${i}]` },
        );
      }
    }
    if (e.default !== null && e.default !== undefined && typeof e.default !== 'string') {
      throw new LedgerError(
        `decisions ${where}.default must be a letter string or null.`,
        { filePath, field: `${where}.default` },
      );
    }
    if (e.blocks !== undefined && typeof e.blocks !== 'string') {
      throw new LedgerError(`decisions ${where}.blocks must be a string when present.`, {
        filePath, field: `${where}.blocks`,
      });
    }
  } else if (name === 'concerns') {
    if (typeof e.concern !== 'string' || e.concern.length === 0) {
      throw new LedgerError(`concerns ${where}.concern must be non-empty.`, {
        filePath, field: `${where}.concern`,
      });
    }
    if (typeof e.reqId !== 'string' || e.reqId.length === 0) {
      throw new LedgerError(`concerns ${where}.reqId must be non-empty.`, {
        filePath, field: `${where}.reqId`,
      });
    }
    if (
      typeof e.disposition !== 'string'
      || !CONCERN_DISPOSITIONS.includes(/** @type {any} */ (e.disposition))
    ) {
      throw new LedgerError(
        `concerns ${where}.disposition must be one of: ${CONCERN_DISPOSITIONS.join(', ')}.`,
        { filePath, field: `${where}.disposition` },
      );
    }
  } else if (name === 'probes') {
    if (typeof e.reqId !== 'string' || e.reqId.length === 0) {
      throw new LedgerError(`probes ${where}.reqId must be non-empty.`, {
        filePath, field: `${where}.reqId`,
      });
    }
    if (typeof e.finding !== 'string' || e.finding.length === 0) {
      throw new LedgerError(`probes ${where}.finding must be non-empty.`, {
        filePath, field: `${where}.finding`,
      });
    }
    if (
      typeof e.severity !== 'string'
      || !PROBE_SEVERITIES.includes(/** @type {any} */ (e.severity))
    ) {
      throw new LedgerError(
        `probes ${where}.severity must be one of: ${PROBE_SEVERITIES.join(', ')}.`,
        { filePath, field: `${where}.severity` },
      );
    }
  }
}

/**
 * Validate a full ledger body (the shape a file holds).
 *
 * @param {LedgerName} name
 * @param {unknown} raw
 * @param {string} [filePath]
 * @returns {Record<string, unknown[]>}
 */
export function validateLedger(name, raw, filePath) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new LedgerError(`Unknown ledger '${name}'.`, { filePath, code: 'usage' });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LedgerError(`${name} ledger must be a JSON object.`, {
      filePath, field: '(root)',
    });
  }
  const body = /** @type {Record<string, unknown>} */ (raw);
  const list = body[cfg.arrayKey];
  if (!Array.isArray(list)) {
    throw new LedgerError(
      `${name} ledger '${cfg.arrayKey}' must be an array.`,
      { filePath, field: cfg.arrayKey },
    );
  }
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    validateEntry(name, entry, filePath, `${cfg.arrayKey}[${i}]`);
    const id = /** @type {any} */ (entry).id;
    if (seen.has(id)) {
      throw new LedgerError(
        `${name} ledger has duplicate id ${id}.`,
        { filePath, field: `${cfg.arrayKey}[${i}].id` },
      );
    }
    seen.add(id);
  }
  return /** @type {Record<string, unknown[]>} */ (body);
}

/**
 * Load a ledger. Returns the empty ledger when the file is absent;
 * throws `LedgerError` on parse / schema failure.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {LedgerName} args.name
 * @returns {Promise<Record<string, unknown[]>>}
 */
export async function loadLedger({ projectRoot, name }) {
  const relPath = ledgerRelPath(name);
  const filePath = ledgerPath(projectRoot, name);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return emptyLedger(name);
    }
    throw new LedgerError(
      `Failed to read ${relPath}: ${/** @type {Error} */ (err).message}`,
      { filePath: relPath, code: 'ioFailure' },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LedgerError(
      `${relPath} parse failed: ${/** @type {Error} */ (err).message}`,
      { filePath: relPath, code: 'parseFailure' },
    );
  }
  return validateLedger(name, parsed, relPath);
}

/**
 * Save a ledger, validating first.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {LedgerName} args.name
 * @param {Record<string, unknown>} args.body
 * @returns {Promise<{ filePath: string }>}
 */
export async function saveLedger({ projectRoot, name, body }) {
  const validated = validateLedger(name, body, ledgerRelPath(name));
  const filePath = ledgerPath(projectRoot, name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return { filePath };
}

/**
 * Highest currently-used id on a ledger; 0 when empty.
 *
 * @param {LedgerName} name
 * @param {Record<string, unknown[]>} body
 * @returns {number}
 */
export function nextIdFor(name, body) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new TypeError(`Unknown ledger '${name}'.`);
  const list = /** @type {any[]} */ (body[cfg.arrayKey] ?? []);
  let max = 0;
  for (const e of list) {
    const id = Number(e?.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

/**
 * Append an entry to a ledger. Mints the next id, stamps `addedAt`,
 * defaults `status: 'open'`, and validates before returning the
 * updated body. Pure over its inputs (does not write to disk); the
 * CLI calls `saveLedger` with the result.
 *
 * @param {object} args
 * @param {LedgerName} args.name
 * @param {Record<string, unknown[]>} args.body
 * @param {Record<string, unknown>} args.entry - fields other than id / addedAt / status
 * @param {string} [args.now] - ISO timestamp; defaults to Date.now()
 * @returns {{ body: Record<string, unknown[]>, entry: Record<string, unknown> }}
 */
export function addEntry({ name, body, entry, now }) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new LedgerError(`Unknown ledger '${name}'.`, { code: 'usage' });
  const id = nextIdFor(name, body);
  const full = {
    id,
    ...entry,
    addedAt: entry.addedAt ?? now ?? new Date().toISOString(),
    status: entry.status ?? 'open',
  };
  const nextBody = { ...body, [cfg.arrayKey]: [...(body[cfg.arrayKey] ?? []), full] };
  validateLedger(name, nextBody, ledgerRelPath(name));
  return { body: nextBody, entry: full };
}

/**
 * Mark an entry `resolved` and stamp `resolvedAt`. Throws `LedgerError`
 * (code `usage`) when the id is unknown. Idempotent-ish: resolving an
 * already-resolved entry refreshes `resolvedAt`.
 *
 * @param {object} args
 * @param {LedgerName} args.name
 * @param {Record<string, unknown[]>} args.body
 * @param {number} args.id
 * @param {Record<string, unknown>} [args.patch] - extra fields (e.g. answer, resolvedBy)
 * @param {string} [args.now]
 * @returns {{ body: Record<string, unknown[]>, entry: Record<string, unknown> }}
 */
export function resolveEntry({ name, body, id, patch = {}, now }) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new LedgerError(`Unknown ledger '${name}'.`, { code: 'usage' });
  const list = /** @type {any[]} */ (body[cfg.arrayKey] ?? []);
  const idx = list.findIndex((e) => Number(e?.id) === Number(id));
  if (idx < 0) {
    throw new LedgerError(`${name} ledger has no entry with id ${id}.`, {
      filePath: ledgerRelPath(name), field: `id ${id}`, code: 'usage',
    });
  }
  const updated = {
    ...list[idx],
    ...patch,
    status: 'resolved',
    resolvedAt: patch.resolvedAt ?? now ?? new Date().toISOString(),
  };
  const nextList = [...list];
  nextList[idx] = updated;
  const nextBody = { ...body, [cfg.arrayKey]: nextList };
  validateLedger(name, nextBody, ledgerRelPath(name));
  return { body: nextBody, entry: updated };
}

/**
 * Parse `--from <file>` content into brief-statement drafts: one entry
 * per non-empty line, stripping a leading `- `, `* ` or `<n>. ` bullet.
 * The caller supplies the `kind` (or `capability` as the default). All
 * statements land as `status: 'open'` at the same `addedAt`; the CLI
 * assigns sequential ids.
 *
 * @param {string} content
 * @param {object} [opts]
 * @param {string} [opts.kind] default kind for every extracted line
 * @param {string} [opts.source] optional source-span label per entry
 * @returns {Array<{ text: string, kind: string, source?: string }>}
 */
export function parseBriefFromFile(content, opts = {}) {
  const kind = opts.kind ?? 'capability';
  /** @type {Array<{ text: string, kind: string, source?: string }>} */
  const drafts = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const stripped = trimmed
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');
    if (!stripped) continue;
    const entry = { text: stripped, kind };
    if (opts.source) entry.source = opts.source;
    drafts.push(entry);
  }
  return drafts;
}

/**
 * Load every ledger the project has actually authored, keyed by name.
 *
 * A project that has never authored a given ledger contributes no
 * `<name>` entry to the returned bundle, so `computeDelta` does not
 * record a `ledger:<name>` docHash for absent ledgers (slice-2 P3
 * resolution: this loader agrees with the `LedgerBundle` typedef on
 * `computeDelta` that "if a project has not authored any decisions,
 * the caller passes no `decisions` key and the delta records no
 * `ledger:decisions` docHash"). Absent-file detection is a `stat` on
 * the ledger path; an ENOENT skips the ledger without loading. A
 * present-but-empty file is still loaded (an operator can `rcf
 * define ledger <name> list --json > <path>` a stub in place; empty
 * ledgers are legal and DO contribute a hash).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<import('../query/delta.js').LedgerBundle>}
 */
export async function loadAllLedgers({ projectRoot }) {
  /** @type {import('../query/delta.js').LedgerBundle} */
  const bundle = {};
  for (const name of LEDGER_NAMES) {
    const filePath = ledgerPath(projectRoot, name);
    try {
      // eslint-disable-next-line no-await-in-loop
      await stat(filePath);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue;
      // Any other stat error (permission etc.) surfaces via loadLedger.
    }
    // eslint-disable-next-line no-await-in-loop
    const body = await loadLedger({ projectRoot, name });
    bundle[name] = body;
  }
  return bundle;
}
