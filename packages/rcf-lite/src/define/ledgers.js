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
    if (e.resolvedBy !== undefined && typeof e.resolvedBy !== 'string') {
      throw new LedgerError(`brief ${where}.resolvedBy must be a string when present.`, {
        filePath, field: `${where}.resolvedBy`,
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

const RESOLVED_BY_GRAMMAR_RE = /^(REQ-\d+|TAD\.entity:.+|PRD\.user:.+|TAD\.system:.+|TAC-\d+(?:-[A-Za-z0-9-]+)?|omitted:.+)$/;

/**
 * True when `pointer` matches the closed grammar for a `resolvedBy`
 * value. Shape-only; does NOT verify that the pointed-to id or name
 * resolves against a tree (that is D2's `skeleton:resolvedBy` check).
 *
 * @param {string} pointer
 * @returns {boolean}
 */
export function isResolvedByGrammar(pointer) {
  if (typeof pointer !== 'string') return false;
  return RESOLVED_BY_GRAMMAR_RE.test(pointer.trim());
}

const KIND_MARKER_RE = /^\[([^\]]+)\]\s*/;
const SOURCE_MARKER_RE = /\s*\(source:\s*([^)]+)\)\s*$/;
const QUESTION_PREFIX_RE = /^(TBC|TBD|Open|Question)\b[:.]?\s*/i;

/**
 * Parse `--from <file>` content into brief-statement drafts: one entry
 * per non-empty line. Each line optionally carries a leading `[kind]`
 * marker and a trailing `(source: ...)` marker. A line without
 * `[kind]` takes `opts.kind` (default `capability`); a line without
 * `(source: ...)` takes `opts.source` or no source. Heuristics kind a
 * line `openQuestion` when it ends with `?` or begins with `TBC`,
 * `TBD`, `Open:` or `Question:`, unless a `[kind]` marker says
 * otherwise. Unknown `[kind]` values raise `LedgerError` (code
 * `usage`) before any write.
 *
 * @param {string} content
 * @param {object} [opts]
 * @param {string} [opts.kind] default kind for every unmarked line
 * @param {string} [opts.source] default source for every unmarked line
 * @returns {Array<{ text: string, kind: string, source?: string }>}
 */
export function parseBriefFromFile(content, opts = {}) {
  const defaultKind = opts.kind ?? 'capability';
  /** @type {Array<{ text: string, kind: string, source?: string }>} */
  const drafts = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let line = trimmed
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');
    if (!line) continue;

    // Trailing (source: ...) marker.
    let source = opts.source;
    const srcMatch = line.match(SOURCE_MARKER_RE);
    if (srcMatch) {
      source = srcMatch[1].trim();
      line = line.slice(0, srcMatch.index).trimEnd();
    }

    // Leading [kind] marker.
    let kind = null;
    const kindMatch = line.match(KIND_MARKER_RE);
    if (kindMatch) {
      kind = kindMatch[1].trim();
      line = line.slice(kindMatch[0].length).trim();
      if (!BRIEF_KINDS.includes(/** @type {any} */ (kind))) {
        throw new LedgerError(
          `brief --from: unknown kind '${kind}' (expected one of: ${BRIEF_KINDS.join(', ')})`,
          { field: 'kind', code: 'usage' },
        );
      }
    }

    if (!line) continue;

    // Heuristics for openQuestion when no [kind] marker was given.
    if (!kind) {
      if (line.endsWith('?') || QUESTION_PREFIX_RE.test(line)) {
        kind = 'openQuestion';
      } else {
        kind = defaultKind;
      }
    }

    const entry = { text: line, kind };
    if (source) entry.source = source;
    drafts.push(entry);
  }
  return drafts;
}

/**
 * Parse a `resolvedBy` pointer against the walker tree. The six
 * accepted forms are `REQ-nnn`, `TAD.entity:<name>`, `PRD.user:<name>`,
 * `TAD.system:<name>`, `TAC-nnnn`, and `omitted:<reason>`. Resolution
 * checks the pointed-to id or name actually exists in the tree
 * (except for `omitted:`, which always passes once the reason is
 * non-empty).
 *
 * @param {string} pointer
 * @param {object} tree  walker tree (TreeModel-like)
 * @returns {{ ok: true, kind: string, target: string } | { ok: false, why: string }}
 */
export function parseResolvedBy(pointer, tree) {
  if (typeof pointer !== 'string' || pointer.length === 0) {
    return { ok: false, why: 'pointer must be a non-empty string' };
  }
  const p = pointer.trim();

  // omitted:<reason>
  const omittedMatch = p.match(/^omitted:(.+)$/);
  if (omittedMatch) {
    const reason = omittedMatch[1].trim();
    if (!reason) return { ok: false, why: 'omitted: pointer needs a reason' };
    return { ok: true, kind: 'omitted', target: reason };
  }

  // REQ-nnn
  if (/^REQ-\d+$/.test(p)) {
    const found = (tree?.requirements ?? []).some((r) => r?.reqId === p);
    if (!found) return { ok: false, why: 'pointer does not resolve' };
    return { ok: true, kind: 'req', target: p };
  }

  // TAC-nnnn (short form, resolves to a tree TAC whose id starts
  // with that prefix) or TAC-nnnn-<slug> (exact-match long form).
  // Codex review 2026-10-02: an unanchored /^TAC-\d+/ let arbitrary
  // suffixes (TAC-4130-made-up) pass as long as the numeric prefix
  // matched an existing TAC; anchor the regex and gate the prefix
  // fallback to the short form only.
  const tacMatch = p.match(/^TAC-\d+(?:-[A-Za-z0-9-]+)?$/);
  if (tacMatch) {
    const tacs = tree?.tacs ?? [];
    const isShortForm = /^TAC-\d+$/.test(p);
    const found = tacs.some((t) => {
      if (!t?.tacId) return false;
      if (t.tacId === p) return true;
      if (!isShortForm) return false;
      return t.tacId.split('-').slice(0, 2).join('-') === p;
    });
    if (!found) return { ok: false, why: 'pointer does not resolve' };
    return { ok: true, kind: 'tac', target: p };
  }

  // TAD.entity:<name>
  const entityMatch = p.match(/^TAD\.entity:(.+)$/);
  if (entityMatch) {
    const name = entityMatch[1].trim();
    if (!name) return { ok: false, why: 'TAD.entity: pointer needs a name' };
    const entities = tree?.tad?.dataArchitecture?.coreEntities ?? [];
    const found = Array.isArray(entities)
      && entities.some((e) => (typeof e === 'string' ? e : e?.name) === name);
    if (!found) return { ok: false, why: 'pointer does not resolve' };
    return { ok: true, kind: 'tadEntity', target: name };
  }

  // PRD.user:<name>
  const userMatch = p.match(/^PRD\.user:(.+)$/);
  if (userMatch) {
    const name = userMatch[1].trim();
    if (!name) return { ok: false, why: 'PRD.user: pointer needs a name' };
    // Codex review 2026-10-02: the production PRD schema uses
    // `targetUsers`; keep `users` as a fallback for the test
    // fixtures but prefer the real path.
    const users = tree?.prd?.targetUsers ?? tree?.prd?.users ?? [];
    const found = Array.isArray(users)
      && users.some((u) => (typeof u === 'string' ? u : u?.name) === name);
    if (!found) return { ok: false, why: 'pointer does not resolve' };
    return { ok: true, kind: 'prdUser', target: name };
  }

  // TAD.system:<name>
  const systemMatch = p.match(/^TAD\.system:(.+)$/);
  if (systemMatch) {
    const name = systemMatch[1].trim();
    if (!name) return { ok: false, why: 'TAD.system: pointer needs a name' };
    // Codex review 2026-10-02: the production TAD schema puts
    // externalSystems inside integrationArchitecture; keep the
    // top-level path as a fallback for the test fixtures.
    const systems = tree?.tad?.integrationArchitecture?.externalSystems ?? tree?.tad?.externalSystems ?? [];
    const found = Array.isArray(systems)
      && systems.some((s) => (typeof s === 'string' ? s : s?.name) === name);
    if (!found) return { ok: false, why: 'pointer does not resolve' };
    return { ok: true, kind: 'tadSystem', target: name };
  }

  return { ok: false, why: 'pointer outside grammar (REQ-nnn, TAD.entity:<name>, PRD.user:<name>, TAD.system:<name>, TAC-nnnn, omitted:<reason>)' };
}

/**
 * Patch a ledger entry in place. Field patches honour `add`-side
 * validation by re-running `validateLedger` on the resulting body.
 * Throws `LedgerError` (code `usage`) when the id is unknown. The
 * entry's `id` and `addedAt` are never touched; `status`, `addedAt`
 * and `resolvedAt` are passed through from the current entry unless
 * explicitly patched.
 *
 * @param {object} args
 * @param {LedgerName} args.name
 * @param {Record<string, unknown[]>} args.body
 * @param {number} args.id
 * @param {Record<string, unknown>} args.patch
 * @returns {{ body: Record<string, unknown[]>, entry: Record<string, unknown> }}
 */
export function updateEntry({ name, body, id, patch }) {
  const cfg = LEDGER_CONFIG[name];
  if (!cfg) throw new LedgerError(`Unknown ledger '${name}'.`, { code: 'usage' });
  const list = /** @type {any[]} */ (body[cfg.arrayKey] ?? []);
  const idx = list.findIndex((e) => Number(e?.id) === Number(id));
  if (idx < 0) {
    throw new LedgerError(`${name} ledger has no entry with id ${id}.`, {
      filePath: ledgerRelPath(name), field: `id ${id}`, code: 'usage',
    });
  }
  const current = list[idx];
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'id' || key === 'addedAt') continue;
    next[key] = value;
  }
  const nextList = [...list];
  nextList[idx] = next;
  const nextBody = { ...body, [cfg.arrayKey]: nextList };
  validateLedger(name, nextBody, ledgerRelPath(name));
  return { body: nextBody, entry: next };
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
