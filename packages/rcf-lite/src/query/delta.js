// Detection model foundation (REQ-172; proposal 2026-09-22 §2.2 v3).
//
// Three pure functions:
//
//   - `hashDocument(doc)`      SHA-256 over the canonical JSON of the
//                              parsed document. `sha256:<hex>` string.
//   - `computeTreeHash(hashes)` SHA-256 over the sorted `(id, docHash)`
//                              pairs, canonically JSON-encoded.
//   - `computeDelta(tree, freeze, ledgers)`
//                              the whole change model, returning the
//                              shape the proposal contracts in §2.2.
//
// Canonical JSON, chosen at proposal §2.1: keys sorted recursively, no
// whitespace, no trailing separators. A hand reformat that changes
// nothing is not a change; that is what an operator expects, and it
// costs one canonicalise per document per read (milliseconds at the
// backstory-scale tree of 700 criteria). Hashing raw bytes would be
// one line shorter and would report drift after `rcf define update`
// rewrote a file it did not semantically touch (ADR-4120).
//
// Document granularity (proposal §2.2, ADR-4120): the delta is a set of
// standalone-document ids -- one entry per document the walker exposes
// on `tree.byId` (PRD, TAD, BS, REQ, US, TAC, ADR, FBS, TS, CN, EVAL),
// plus one `ledger:<name>` entry per sidecar ledger the caller passes.
// Inline AC and TC entries ride inside the parent hash: editing
// `AC-207-4` shows as `US-207 changed`, and the criterion-level diff is
// git's job.
//
// Pure: no filesystem I/O, no state, no time. Every call takes plain
// data in and returns plain data out.

import { createHash } from 'node:crypto';

/**
 * Canonicalise a value to the JSON string the hash is taken over.
 *
 * - Objects: keys sorted lexicographically, then each `<key>:<value>`
 *   joined by `,` and wrapped in `{}`.
 * - Arrays: elements in source order, canonicalised, joined by `,`
 *   and wrapped in `[]`.
 * - Strings: `JSON.stringify` (RFC 8259 escaping).
 * - Numbers and booleans: `JSON.stringify` (finite numbers only; NaN
 *   and +/-Infinity yield `null` in JSON, which is honest for a value
 *   the parsed document could not legally hold).
 * - `null` and `undefined`: `undefined` is omitted from objects and
 *   arrays (matches `JSON.stringify` semantics); a top-level
 *   `undefined` yields the empty string, which the caller treats as a
 *   distinct value from `null` (never expected in a parsed document).
 *
 * No whitespace anywhere. Deterministic on the input tree.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicaliseJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') return '';
  if (Array.isArray(value)) {
    const parts = [];
    for (const el of value) {
      // JSON.stringify drops undefined elements to null in arrays; keep
      // that shape so an accidentally-sparse array hashes the same as
      // its JSON.stringify form (never expected in a parsed document,
      // where JSON.parse cannot produce one).
      parts.push(el === undefined ? 'null' : canonicaliseJson(el));
    }
    return `[${parts.join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(/** @type {object} */ (value)).sort();
    const parts = [];
    for (const k of keys) {
      const v = (/** @type {Record<string, unknown>} */ (value))[k];
      if (v === undefined) continue; // JSON.stringify omits undefined in objects.
      parts.push(`${JSON.stringify(k)}:${canonicaliseJson(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  // Functions, symbols, bigints: never legally present in a parsed
  // document. Fall back to JSON.stringify's own null coercion.
  return 'null';
}

/**
 * Hash one parsed document. Returns `sha256:<64-hex>` per proposal
 * §2.1. Accepts any value the walker's `tree.byId` map holds (an
 * object) and also `null` / primitives (a ledger sidecar hashed as a
 * whole, for example, may pass a plain array).
 *
 * @param {unknown} doc
 * @returns {string}
 */
export function hashDocument(doc) {
  const canonical = canonicaliseJson(doc);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Hash a `docHashes` map. Sorts the `(id, docHash)` pairs
 * lexicographically by id, canonically encodes the array of pairs,
 * and hashes that string. Matches proposal §2.1 ("the sorted (id,
 * docHash) pairs"). Accepts a plain object or a Map.
 *
 * @param {Record<string, string> | Map<string, string>} docHashes
 * @returns {string}
 */
export function computeTreeHash(docHashes) {
  /** @type {[string, string][]} */
  const pairs = [];
  if (docHashes instanceof Map) {
    for (const [id, h] of docHashes) pairs.push([String(id), String(h)]);
  } else if (docHashes && typeof docHashes === 'object') {
    for (const [id, h] of Object.entries(docHashes)) pairs.push([id, String(h)]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hex = createHash('sha256').update(canonicaliseJson(pairs), 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Every standalone-document id the walker holds, sorted. Every id in
 * `tree.byId` (PRD, TAD, BS, REQ, US, TAC, ADR, FBS, TS, CN, EVAL).
 * Inline AC / TC ids ride inside their parent's hash and are NOT
 * enumerated here; delta granularity is the standalone document
 * (proposal §2.2, ADR-4120).
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {string[]}
 */
function standaloneIds(tree) {
  if (!tree || !tree.byId) return [];
  return [...tree.byId.keys()].sort();
}

/**
 * @typedef {object} LedgerBundle
 * @property {unknown} [brief]     brief-ledger.json body (null / absent = untouched)
 * @property {unknown} [decisions] decisions-ledger.json body
 * @property {unknown} [concerns]  concern-ledger.json body
 * @property {unknown} [probes]    probe-ledger.json body
 *
 * The delta hashes only the ledgers the caller passes -- if a project
 * has not authored any decisions, the caller passes no `decisions`
 * key and the delta records no `ledger:decisions` docHash. This
 * keeps the model additive: sidecars appear when they exist, never
 * before.
 */

/**
 * @typedef {object} FreezeRecord
 * @property {string} [frozenAt]
 * @property {string} [treeHash]
 * @property {Record<string, string>} [docHashes]
 * @property {number} [briefStatements]
 */

/**
 * @typedef {object} DeltaResult
 * @property {boolean} frozen
 *   false when the freeze record is absent (a fresh tree; everything
 *   is `added`, per proposal §2.2 "before the first freeze the delta
 *   is the whole tree").
 * @property {string | null} frozenAt
 * @property {string | null} treeHash
 *   The tree hash the freeze record stored, or null when unfrozen.
 * @property {string} currentTreeHash
 *   The tree hash recomputed from the live tree.
 * @property {string[]} changed  ids whose hash differs
 * @property {string[]} added    ids not in `docHashes`
 * @property {string[]} removed  ids in `docHashes` with no live document
 * @property {number[]} briefSince
 *   Ledger-brief statement ids above the freeze high-water mark.
 * @property {number} unchanged  count of ids present in both maps with
 *                               the same hash (excludes ledgers).
 */

/**
 * Compute the delta between the live tree and the freeze record.
 *
 * Pure. No filesystem, no time, no state. Runs on every read (the
 * proposal's whole point: the freeze record and the tree are the only
 * inputs to the change model).
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {FreezeRecord | null | undefined} freeze
 * @param {LedgerBundle | null | undefined} [ledgers]
 * @returns {DeltaResult}
 */
export function computeDelta(tree, freeze, ledgers) {
  /** @type {Record<string, string>} */
  const currentHashes = {};
  for (const id of standaloneIds(tree)) {
    currentHashes[id] = hashDocument(tree.byId.get(id));
  }
  const ledgerBundle = ledgers ?? {};
  for (const [name, body] of Object.entries(ledgerBundle)) {
    if (body === undefined || body === null) continue;
    currentHashes[`ledger:${name}`] = hashDocument(body);
  }

  const currentTreeHash = computeTreeHash(currentHashes);

  // Unfrozen path (proposal §2.2): the delta is the whole tree,
  // reported as `added`. frozenAt / treeHash null; briefSince empty
  // (there is no high-water mark to compare against yet, and D1's
  // scoping rule keeps the greenfield brief in the delta by definition
  // -- the ledger itself is a docHash entry when the caller passes one).
  if (!freeze || typeof freeze !== 'object' || !freeze.docHashes) {
    return {
      frozen: false,
      frozenAt: null,
      treeHash: null,
      currentTreeHash,
      changed: [],
      added: Object.keys(currentHashes).sort(),
      removed: [],
      briefSince: [],
      unchanged: 0,
    };
  }

  const frozenHashes = freeze.docHashes;
  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const removed = [];
  let unchanged = 0;

  const liveIds = Object.keys(currentHashes);
  for (const id of liveIds) {
    if (Object.prototype.hasOwnProperty.call(frozenHashes, id)) {
      if (frozenHashes[id] === currentHashes[id]) unchanged += 1;
      else changed.push(id);
    } else {
      added.push(id);
    }
  }
  for (const id of Object.keys(frozenHashes)) {
    if (!Object.prototype.hasOwnProperty.call(currentHashes, id)) removed.push(id);
  }
  changed.sort();
  added.sort();
  removed.sort();

  const highWater = Number.isFinite(freeze.briefStatements) ? Number(freeze.briefStatements) : 0;
  /** @type {number[]} */
  const briefSince = [];
  const brief = ledgerBundle.brief;
  if (brief && typeof brief === 'object' && Array.isArray(/** @type {any} */ (brief).statements)) {
    for (const s of /** @type {any} */ (brief).statements) {
      if (!s || typeof s !== 'object') continue;
      const n = Number(s.id);
      if (Number.isFinite(n) && n > highWater) briefSince.push(n);
    }
    briefSince.sort((a, b) => a - b);
  }

  return {
    frozen: true,
    frozenAt: typeof freeze.frozenAt === 'string' ? freeze.frozenAt : null,
    treeHash: typeof freeze.treeHash === 'string' ? freeze.treeHash : null,
    currentTreeHash,
    changed,
    added,
    removed,
    briefSince,
    unchanged,
  };
}
