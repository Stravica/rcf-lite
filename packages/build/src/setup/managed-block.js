// Generic "managed block in file X" primitive (0.6.0 spec §11). Both
// the agent-instructions check (strand 1) and the gitignore check
// (strand 4) call into this module with their respective (marker-pair,
// canonical-text) tuples. Doctor's per-check code stays small; every
// managed-block check shares one implementation of the detect / extract
// / splice / hash primitives.
//
// Design rules from the spec:
// - Detection semantics enumerated at §2.6 / §4.4 (missing, stale-hash,
//   legacy-markers, orphan-marker, duplicate-block).
// - --fix is wholesale replacement inside the markers; zero bytes
//   touched outside; newline normalisation is off (§2.7).
// - Structurally corrupt files (orphan / duplicate) are refused by
//   --fix; hand-repair message returned.
// - Idempotent: running --fix on already-clean state is a no-op that
//   writes zero files (§2.7 last bullet).

import { createHash } from 'node:crypto';

/**
 * @typedef {'clean' | 'missing-block' | 'stale-hash' | 'legacy-markers' | 'orphan-marker' | 'duplicate-block'} BlockState
 */

/**
 * @typedef {object} BlockOptions
 * @property {string} markerBegin - current-generation begin marker.
 * @property {string} markerEnd - current-generation end marker.
 * @property {string | null} [legacyMarkerBegin] - pre-0.6.0 begin marker; omit to disable legacy detection.
 * @property {string | null} [legacyMarkerEnd] - pre-0.6.0 end marker; omit to disable legacy detection.
 */

/**
 * SHA-256 of the trimmed text, matching gen-managed-artefacts.mjs's
 * hashOf. Whitespace around marker lines does not trip staleness.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashInnerContent(text) {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}

/**
 * Locate the marker pair's byte offsets within `text`. Returns
 * `beginIndex` (offset of MARKER_BEGIN's first char), `endIndex`
 * (offset of the character AFTER MARKER_END, INCLUSIVE of a trailing
 * newline if one exists), and `innerText` (bytes strictly between the
 * markers, no surrounding newlines).
 *
 * @param {string} text
 * @param {string} markerBegin
 * @param {string} markerEnd
 * @returns {{ beginIndex: number, endIndex: number, innerText: string } | null}
 */
export function locateMarkers(text, markerBegin, markerEnd) {
  const beginIndex = text.indexOf(markerBegin);
  if (beginIndex < 0) return null;
  const innerStart = beginIndex + markerBegin.length;
  const endStart = text.indexOf(markerEnd, innerStart);
  if (endStart < 0) return null;
  let endIndex = endStart + markerEnd.length;
  if (text[endIndex] === '\n') endIndex += 1;
  const innerText = text.slice(innerStart, endStart);
  return { beginIndex, endIndex, innerText };
}

/**
 * Count occurrences of `needle` in `haystack`.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) return count;
    count += 1;
    i = at + needle.length;
  }
}

/**
 * Classify the file's managed-block state given the current-generation
 * markers, the pre-0.6.0 legacy markers (optional), and the canonical
 * hash the caller expects the block's inner content to match.
 *
 * @param {string} fileText - the file's raw bytes as UTF-8 string.
 * @param {string} canonicalHash - SHA-256 of the current canonical text (trimmed).
 * @param {BlockOptions} opts
 * @returns {BlockState}
 */
export function classifyBlock(fileText, canonicalHash, opts) {
  const { markerBegin, markerEnd, legacyMarkerBegin, legacyMarkerEnd } = opts;
  const beginCount = countOccurrences(fileText, markerBegin);
  const endCount = countOccurrences(fileText, markerEnd);
  // Duplicate block detection first: more than one pair is unambiguous.
  if (beginCount >= 2 && endCount >= 2) return 'duplicate-block';
  // Orphan (unpaired current-marker) after duplicate; either half missing.
  if (beginCount !== endCount) return 'orphan-marker';
  // If neither current marker present, fall through to legacy / missing.
  if (beginCount === 0) {
    if (legacyMarkerBegin && legacyMarkerEnd) {
      const legBegin = countOccurrences(fileText, legacyMarkerBegin);
      const legEnd = countOccurrences(fileText, legacyMarkerEnd);
      if (legBegin >= 1 && legEnd >= 1) return 'legacy-markers';
    }
    return 'missing-block';
  }
  // Exactly one pair present; hash the inner content.
  const located = locateMarkers(fileText, markerBegin, markerEnd);
  if (!located) return 'orphan-marker';
  const innerHash = hashInnerContent(located.innerText);
  return innerHash === canonicalHash ? 'clean' : 'stale-hash';
}

/**
 * Produce the composed block string (markers + canonical text). Callers
 * splice this into the file at the location `locateMarkers` reported.
 *
 * @param {string} canonicalText
 * @param {string} markerBegin
 * @param {string} markerEnd
 * @returns {string}
 */
export function composeBlock(canonicalText, markerBegin, markerEnd) {
  const trimmed = canonicalText.trim();
  return `${markerBegin}\n${trimmed}\n${markerEnd}\n`;
}

/**
 * Rewrite `fileText` in place with the composed block:
 * - `clean`: return the input unchanged (idempotent no-op).
 * - `stale-hash`: splice the composed block over the current pair,
 *   preserving every byte outside the markers.
 * - `legacy-markers`: splice the composed block over the legacy pair,
 *   preserving every byte outside the legacy markers.
 * - `missing-block`: append the composed block at end of file, adding a
 *   leading blank-line separator if the file did not end in a newline.
 * - `orphan-marker` / `duplicate-block`: refused; returns null so the
 *   caller emits the hand-repair message.
 *
 * @param {string} fileText
 * @param {string} canonicalText
 * @param {BlockOptions} opts
 * @param {string} canonicalHash
 * @returns {{ nextText: string, action: 'noop' | 'replaced' | 'migrated' | 'appended' } | null}
 */
export function applyFix(fileText, canonicalText, opts, canonicalHash) {
  const state = classifyBlock(fileText, canonicalHash, opts);
  const composed = composeBlock(canonicalText, opts.markerBegin, opts.markerEnd);
  if (state === 'clean') {
    return { nextText: fileText, action: 'noop' };
  }
  if (state === 'orphan-marker' || state === 'duplicate-block') {
    return null;
  }
  if (state === 'stale-hash') {
    const loc = locateMarkers(fileText, opts.markerBegin, opts.markerEnd);
    if (!loc) return null;
    const nextText = fileText.slice(0, loc.beginIndex) + composed + fileText.slice(loc.endIndex);
    return { nextText, action: 'replaced' };
  }
  if (state === 'legacy-markers' && opts.legacyMarkerBegin && opts.legacyMarkerEnd) {
    const loc = locateMarkers(fileText, opts.legacyMarkerBegin, opts.legacyMarkerEnd);
    if (!loc) return null;
    const nextText = fileText.slice(0, loc.beginIndex) + composed + fileText.slice(loc.endIndex);
    return { nextText, action: 'migrated' };
  }
  // missing-block
  const separator = fileText.length === 0
    ? ''
    : (fileText.endsWith('\n') ? '\n' : '\n\n');
  return { nextText: `${fileText}${separator}${composed}`, action: 'appended' };
}

/**
 * Extract only the inner content of the current-marker block, or null
 * if the file has no clean pair. For diagnostics: doctor's `stale-hash`
 * report can quote or diff the block if it wants to (v1 does not).
 *
 * @param {string} fileText
 * @param {string} markerBegin
 * @param {string} markerEnd
 * @returns {string | null}
 */
export function extractInnerContent(fileText, markerBegin, markerEnd) {
  const located = locateMarkers(fileText, markerBegin, markerEnd);
  return located ? located.innerText : null;
}
