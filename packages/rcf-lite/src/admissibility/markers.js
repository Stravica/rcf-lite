// Source-comment marker scanner (NV-BL-ADM-04).
//
// Scans a set of source files for admission markers from the ratified
// vocabulary carried on the shared standards ruleset
// (`sourceCommentMarkers[]`). Any match is a finding. Per ratified
// ruling-sheet item 16, the only permitted override channel is an ADR
// recording the deferral for a genuine external-boundary blocker; the
// generic recorded-override channel (NV-BL-ADM-05) does not cover
// source markers.
//
// This module produces findings only. Wiring the gate into
// `rcf build --mark complete` is a build-lite verb change that reads
// the FBS's build-sequence files and calls `scanSourceForMarkers` for
// each; the CLI change belongs in that verb's PR, not here.

import { readFile } from 'node:fs/promises';

import { rcfError } from '#core/errors';
import { getRuleset } from '#ruleset';

/**
 * Compile the ruleset's marker vocabulary into a single case-insensitive
 * pattern. Markers are ratified as case-insensitive per NV-BL-ADM-04, so
 * we build the pattern with the `i` flag. Longest markers first so
 * "v1 refinement" wins over "v1" if a shorter marker is ever added to
 * the vocabulary in future releases.
 *
 * @param {Array<{ marker: string, caseInsensitive: boolean }>} markers
 * @returns {RegExp}
 */
function compileMarkerPattern(markers) {
  const sorted = [...markers].sort((a, b) => b.marker.length - a.marker.length);
  const alternation = sorted
    .map((m) => m.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // Boundary-free by design: matches a marker anywhere in a comment
  // ("PLACEHOLDER function" matches; "// placeholder" matches; a random
  // word like "todos" also matches, which is the trade-off named in the
  // ruleset's NV-BL-ADM-04 notes -- false positives on unrelated tokens
  // are cheaper than false negatives on real deferrals.
  return new RegExp(`(${alternation})`, 'ig');
}

/**
 * Scan a single source string for the ratified marker vocabulary.
 * Returns one finding per match, with line + column offsets. Empty
 * input returns an empty findings array.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {string} [opts.filePath] - decorates each finding for callers
 * @param {Array<{ marker: string, caseInsensitive: boolean }>} [opts.markers]
 * @returns {Promise<import('#core/errors').RcfError[]>}
 */
export async function scanSourceStringForMarkers(source, { filePath, markers } = {}) {
  if (typeof source !== 'string' || source.length === 0) return [];
  const vocab = markers ?? (await getRuleset()).sourceCommentMarkers;
  const pattern = compileMarkerPattern(vocab);
  const findings = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = match.index - (lastNewline === -1 ? -1 : lastNewline);
    findings.push(rcfError({
      kind: 'validation',
      message: `NV-BL-ADM-04: source-comment admission marker "${match[1]}" at ${filePath ?? '<source>'}:${line}:${column}`,
      filePath: filePath ?? null,
      rule: 'NV-BL-ADM-04',
    }));
  }
  return findings;
}

/**
 * Scan a set of files by path for the ratified marker vocabulary. IO
 * failures on a single file are captured as `ioFailure` findings; other
 * files continue to scan. Order is deterministic in the input file list.
 *
 * @param {string[]} filePaths - absolute paths to scan
 * @returns {Promise<import('#core/errors').RcfError[]>}
 */
export async function scanFilesForMarkers(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const ruleset = await getRuleset();
  const vocab = ruleset.sourceCommentMarkers;
  const findings = [];
  for (const filePath of filePaths) {
    try {
      const source = await readFile(filePath, 'utf8');
      const perFile = await scanSourceStringForMarkers(source, { filePath, markers: vocab });
      findings.push(...perFile);
    } catch (err) {
      findings.push(rcfError({
        kind: 'ioFailure',
        message: `NV-BL-ADM-04: failed to read source for marker scan: ${err.message}`,
        filePath,
        rule: 'NV-BL-ADM-04',
      }));
    }
  }
  return findings;
}
