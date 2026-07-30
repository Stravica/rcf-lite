// Aggregator seam for the managed `.gitignore` block (0.6.0 spec §4,
// D-4 normative aggregator function). The registry of "files RCF wants
// ignored by default" is composed by `managedGitignoreEntries()`. This
// module is the single shared file that 0.7.0+ extends: import a
// per-feature entry constant from its owning module and insert into the
// array, one file, two lines added, no doctor code change (§4.1's
// worked 0.7.0 diff).
//
// The `.gitignore` marker convention shares the visual shape of the
// agent-instructions markers but lives in a disjoint namespace
// (gitignore uses `#` for comments). Doctor's per-check logic still
// calls into the generic managed-block primitive in `managed-block.js`
// with these markers as its (markerBegin, markerEnd) pair.

import { hashInnerContent } from './managed-block.js';
import { identityEntry } from './identity-seed.js';

/**
 * @typedef {object} GitignoreEntry
 * @property {string} path - gitignore-syntax line (glob or literal path relative to project root).
 * @property {string} owner - human-readable feature name shown in the block's owner comment.
 * @property {string} since - SemVer minor the entry landed on.
 */

/**
 * Registered gitignore entries the managed block covers. Each entry
 * exports from its owning feature module (per §4.1's contract: feature
 * modules OWN their entry constant and do NOT import the aggregator,
 * avoiding import-time mutation surprises); the aggregator imports and
 * composes deterministically. Adding an entry (e.g. the 0.7.0
 * credentials side-file) is a one-file edit here: import the constant
 * and insert into `registered`. Do NOT mutate this array at runtime;
 * callers should treat the returned array as read-only.
 *
 * @param {object} [override] - test-only aggregator extension (§10 unit
 *   test coverage): pass `{ extraEntries: [...] }` to compose an
 *   extended block without touching the source file. AC-3.6 uses this
 *   to exercise the extension path end-to-end without a mock or an
 *   array `.push`.
 * @returns {GitignoreEntry[]}
 */
export function managedGitignoreEntries(override) {
  const registered = [
    identityEntry,
    // 0.7.0 will add:
    //   import { preflightEntry } from '../preflight/index.js';
    // above, and insert `preflightEntry` here.
  ];
  if (override && Array.isArray(override.extraEntries) && override.extraEntries.length > 0) {
    return [...registered, ...override.extraEntries];
  }
  return registered;
}

/** Owner-comment header on the begin marker (§4.3 canonical text). */
export const GITIGNORE_MARKER_BEGIN = '# rcf:managed:begin (managed by `rcf doctor`; do not edit inside)';
export const GITIGNORE_MARKER_END = '# rcf:managed:end';

/**
 * Compose the managed block from the aggregator. Deterministic order
 * (aggregator's registered order); each entry preceded by its one-line
 * owner comment `# {owner} (since {since})`; trailing newline outside
 * the end marker so the block sits cleanly inside a file. Callers
 * splice the return value in place; the return is the FULL block
 * (marker + inner + marker + terminating newline).
 *
 * @param {object} [opts]
 * @param {GitignoreEntry[]} [opts.extraEntries] - test-only aggregator extension (see AC-3.6).
 * @returns {string}
 */
export function composeGitignoreBlock(opts) {
  const entries = managedGitignoreEntries(opts);
  const lines = [GITIGNORE_MARKER_BEGIN];
  for (const e of entries) {
    lines.push(`# ${e.owner} (since ${e.since})`);
    lines.push(e.path);
  }
  lines.push(GITIGNORE_MARKER_END);
  return `${lines.join('\n')}\n`;
}

/**
 * The inner-content string the composed block wraps: everything
 * strictly between the marker lines. Doctor's stale-hash primitive
 * hashes this (trimmed) so operator whitespace around markers is
 * ignored.
 *
 * @param {object} [opts]
 * @returns {string}
 */
export function composeGitignoreInner(opts) {
  const entries = managedGitignoreEntries(opts);
  const lines = [];
  for (const e of entries) {
    lines.push(`# ${e.owner} (since ${e.since})`);
    lines.push(e.path);
  }
  return `${lines.join('\n')}`;
}

/**
 * SHA-256 of the composed inner content (trimmed). Doctor compares this
 * to the hash of the inner content extracted from the file; mismatch
 * means stale.
 *
 * @param {object} [opts]
 * @returns {string}
 */
export function computeGitignoreBlockHash(opts) {
  return hashInnerContent(composeGitignoreInner(opts));
}

/**
 * Locate the managed gitignore block within `text`. Same primitive as
 * managed-block.js's `locateMarkers` but exported here for the doctor
 * flow's convenience.
 *
 * @param {string} text
 * @returns {{ beginIndex: number, endIndex: number, innerText: string } | null}
 */
export function extractGitignoreBlock(text) {
  const beginIndex = text.indexOf(GITIGNORE_MARKER_BEGIN);
  if (beginIndex < 0) return null;
  const innerStart = beginIndex + GITIGNORE_MARKER_BEGIN.length;
  const endStart = text.indexOf(GITIGNORE_MARKER_END, innerStart);
  if (endStart < 0) return null;
  let endIndex = endStart + GITIGNORE_MARKER_END.length;
  if (text[endIndex] === '\n') endIndex += 1;
  const innerText = text.slice(innerStart, endStart);
  return { beginIndex, endIndex, innerText };
}
