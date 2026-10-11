// Discovery context loader (FBS-214, REQ-189, TAC-4142, ADR-4146).
//
// `loadDiscoveryContext` is the single IO entry point for D0: it reads
// `rcf/discovery/journey.json` (and nothing else when the record is
// absent or declared `none`, per AC-18905-3) and, for a declared
// `light` or `central` product, pre-loads the wireframe bytes that
// `checkDiscovery` and `checkD0Discovery` consume.
//
// Pure composition rules:
//   - record === null AND hasRecordFile === false: the grandfathered
//     state (ADR-4145); no wireframe is read.
//   - record.ui === 'none': product declared not UI-bearing; no
//     wireframe is read.
//   - record.ui === null (init-seeded): D0 fails on discovery:declared
//     without reading any wireframe.
//   - record.ui === 'light' | 'central': every Screen.wireframe path
//     is loaded as bytes; .html files are also decoded as utf-8 so
//     scanHtmlForExternalUrls has text to walk.
//
// Containment: wireframe paths are refused at the record write path
// for URL-ish, absolute and '..' segments; this loader additionally
// realpaths each loaded file and skips any path that escapes the
// repo root (symlink inside the repo pointing outside). An ENOENT is
// a soft miss: the path simply does not appear in the wireframes map,
// which is how `discovery:wireframePerStep` surfaces the gap on a
// central product (AC-18903-3; FBS-213 wired the same refusal on
// `rcf discover journey check` and `review`).
//
// Node built-ins only.

import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import {
  JourneyRecordError,
  readJourneyRecord,
} from './record.js';

/**
 * Load the D0 discovery context for `projectRoot`.
 *
 * Returns an object that satisfies `DiscoveryContext` in gates.js:
 *   { record, hasRecordFile, wireframes }
 *
 * When the record file is absent, missing wireframe files, or a
 * record parse failure happens, the returned context carries the
 * best-effort shape:
 *   - absent file: { record: null, hasRecordFile: false, wireframes: Map() }
 *   - parse failure: logged to warnings[], returns the same shape as
 *     absent so D0 still folds to notApplicable rather than crashing
 *     the compute. The parse error is retained on `.parseError` for
 *     the caller to surface alongside readiness output when wanted.
 *
 * @param {object} args
 * @param {string} args.projectRoot   realpath of the project root
 * @returns {Promise<import('../query/gates.js').DiscoveryContext & { parseError?: Error }>}
 */
export async function loadDiscoveryContext({ projectRoot }) {
  const empty = {
    record: /** @type {any} */ (null),
    hasRecordFile: false,
    wireframes: new Map(),
  };
  let record;
  try {
    record = await readJourneyRecord(projectRoot);
  } catch (err) {
    // F1 (ADR-4145): grandfathering is BY ABSENCE ONLY. A malformed,
    // schema-invalid or unreadable record is a declared file in an
    // invalid state - the door must refuse. We report that through
    // `invalidRecord` (plus `parseError` for message surfacing); the
    // record file is present even though we could not read a valid
    // record out of it, so `hasRecordFile` is true.
    const parseError = err instanceof Error ? err : new Error(String(err));
    return {
      record: /** @type {any} */ (null),
      hasRecordFile: true,
      wireframes: new Map(),
      invalidRecord: parseError,
      parseError,
    };
  }
  if (record === null) {
    return empty;
  }

  const ui = record.ui ?? null;
  // AC-18905-3: no wireframe is read for an absent record, a declared
  // `none` product, or an init-seeded record (ui null). The latter
  // also stays failing on discovery:declared alone.
  if (ui === 'none' || ui === null) {
    return { record, hasRecordFile: true, wireframes: new Map() };
  }

  // ui === 'light' | 'central': load the wireframe bytes. A light
  // product never fails for a missing wireframe (checkDiscovery marks
  // discovery:wireframePerStep notApplicable), but we still load the
  // bytes that ARE present so wireframeFormat and
  // wireframeSelfContained can run against them (AC-18903-8).
  const wireframes = new Map();
  for (const screen of record.screens) {
    if (!screen.wireframe) continue;
    const absPath = join(projectRoot, screen.wireframe);
    const escaped = await resolvedOutsideRoot(absPath, projectRoot);
    if (escaped) {
      // A symlink inside the repo pointing outside; refuse to read
      // but keep the record otherwise usable. The path simply does
      // not appear in the wireframes map, which lets D0 report a
      // missing wireframe on central with the same shape as ENOENT.
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(absPath);
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT') continue;
      // Other IO errors (EISDIR, EACCES, ...) are soft here: the
      // readiness CLI should not refuse a compute because a wireframe
      // file could not be read. Report by absence.
      continue;
    }
    const entry = { bytes };
    const ext = screen.wireframe.toLowerCase();
    if (ext.endsWith('.html')) entry.text = bytes.toString('utf8');
    wireframes.set(screen.wireframe, entry);
  }
  return { record, hasRecordFile: true, wireframes };
}

/**
 * realpath-based containment check: a repo-relative path joined to
 * rootCanonical must resolve inside rootCanonical. Returns the
 * escaped canonical path when it leaves the repo and null otherwise.
 * A path that does not exist yet (ENOENT) resolves through its longest
 * existing prefix. Any other failure (non-ENOENT) returns null so the
 * caller does not refuse on an unrelated IO issue.
 *
 * @param {string} absPath         absolute path to check
 * @param {string} rootCanonical   realpath of the project root
 * @returns {Promise<string | null>}  escaped path or null
 */
async function resolvedOutsideRoot(absPath, rootCanonical) {
  let resolved;
  try {
    resolved = await realpath(absPath);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code !== 'ENOENT') return null;
    resolved = absPath;
  }
  const rootWithSep = rootCanonical.endsWith('/') ? rootCanonical : `${rootCanonical}/`;
  if (resolved === rootCanonical) return null;
  if (resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export { JourneyRecordError };
