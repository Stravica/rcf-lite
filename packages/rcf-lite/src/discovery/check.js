// Pure discovery check for the UX intake gate (REQ-189, TAC-4142,
// ADR-4143, ADR-4144, FBS-212, US-18903).
//
// checkDiscovery({ record, ui, wireframes }) returns the list of
// discovery:* checks over an in-memory JourneyRecord and the wireframe
// bytes the caller has pre-loaded. Pure, no filesystem IO: the CLI
// verb that drives it opens the files, loads their bytes and hands
// them in.
//
// FBS-212 implements the structural and wireframe checks the check
// verb runs:
//
//   - journeyPresent         : at least one journey with an entry and an exit
//   - stepsNameScreens       : every step.screenId resolves to a Screen
//   - reachable              : every step reachable from an entry step AND no
//                              non-exit step is a dead end (no next and no
//                              returnsTo); the dead-end case is reported with
//                              a distinct why from the unreachable case
//   - interruptions          : every catalogue entry is covered by a step of any
//                              kind OR ruled out as notApplicable:<reason> with
//                              a reason body of at least 20 characters
//   - wireframePerStep       : (central only) every step's Screen.wireframe is
//                              non-null and the bytes are present
//   - wireframeFormat        : every wireframe path has an admitted extension
//                              (.md, .html; .png only when record.asBuilt)
//   - wireframeSelfContained : every .html wireframe is free of external URLs
//                              in any of href, src, srcset, CSS url(),
//                              CSS @import
//
// Grandfathering (ADR-4143): when ui === 'none' OR record is null, the
// whole check list folds to one notApplicable entry with a reason and
// the caller reads no wireframe file (AC-18903-7). The caller enforces
// that no-file-read contract; this module simply never asks for them.
//
// Node built-ins only.

import { basename, extname } from 'node:path';

import { scanHtmlForExternalUrls, checkWireframeFormat } from './hash.js';

/** The v1 catalogue, in the order the ux-designer role prints it. The
 *  value is frozen so a test that mutates it would throw rather than
 *  break every suite silently (defence in depth). */
export const INTERRUPTION_CATALOGUE_V1 = Object.freeze([
  'lostEmail',
  'closedTab',
  'deadBattery',
  'expiredLink',
  'switchedDevice',
  'lostSignal',
]);

/** The reason-body floor on an interruption notApplicable value, in
 *  characters AFTER the 'notApplicable:' prefix. */
export const NOT_APPLICABLE_REASON_FLOOR = 20;

/**
 * @typedef {object} CheckResult
 * @property {string} id          - the check id, e.g. 'discovery:journeyPresent'
 * @property {'pass' | 'fail' | 'notApplicable'} state
 * @property {string} why         - a short human-readable reason; empty on pass
 * @property {string[]} [failingIds] - ids that caused the failure (step ids,
 *                                     screen ids, journey ids, file paths); may
 *                                     be empty on pass or notApplicable
 */

/**
 * The pre-loaded wireframe bytes the caller hands checkDiscovery.
 *
 * The map key is the repo-relative path exactly as it appears on
 * Screen.wireframe. The value is the file bytes (Buffer or
 * Uint8Array) and, for an .html file, the decoded text. The caller
 * MUST only include screens whose wireframe is non-null; a null
 * wireframe is signalled by its absence from this map.
 *
 * @typedef {object} WireframeBytes
 * @property {Buffer | Uint8Array} bytes
 * @property {string} [text]  // utf-8 decoded text; required for .html
 */

/**
 * The input to checkDiscovery.
 *
 * `record` is the JourneyRecord body (never null when this function is
 * called; the caller folds null to notApplicable before calling);
 * `ui` is the authoritative declaration (record.ui); `wireframes` is
 * the map above.
 *
 * @typedef {object} CheckInput
 * @property {import('./record.js').JourneyRecord} record
 * @property {'none' | 'light' | 'central' | null} ui
 * @property {Map<string, WireframeBytes>} wireframes
 */

/**
 * Run the discovery check list over a loaded record.
 *
 * @param {CheckInput} input
 * @returns {CheckResult[]}
 */
export function checkDiscovery({ record, ui, wireframes }) {
  // AC-18903-7: a declared none product folds to one notApplicable
  // entry with a reason and the caller reads no wireframe file. We
  // signal that fold by returning a single-entry list so a caller
  // that iterates results prints one line and exits 0.
  if (ui === 'none') {
    return [
      {
        id: 'discovery:applicable',
        state: 'notApplicable',
        why: 'ui declared none; no journey, wireframes or review required.',
        failingIds: [],
      },
    ];
  }
  if (!record) {
    return [
      {
        id: 'discovery:applicable',
        state: 'notApplicable',
        why: 'no rcf/discovery/journey.json: the grandfathered state (existing tree, no ui declaration yet).',
        failingIds: [],
      },
    ];
  }

  const results = [];
  results.push(checkJourneyPresent(record));
  results.push(checkStepsNameScreens(record));
  results.push(checkReachable(record));
  results.push(checkInterruptions(record));
  results.push(checkWireframePerStepFor(record, ui));
  results.push(checkWireframeFormatAll(record));
  results.push(checkWireframeSelfContainedAll(record, wireframes));
  return results;
}

/**
 * discovery:journeyPresent - at least one journey with an entry and
 * an exit step.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @returns {CheckResult}
 */
function checkJourneyPresent(record) {
  if (record.journeys.length === 0) {
    return {
      id: 'discovery:journeyPresent',
      state: 'fail',
      why: 'no journey has been authored: run rcf discover journey add or import.',
      failingIds: [],
    };
  }
  const defective = [];
  for (const j of record.journeys) {
    const hasEntry = j.steps.some((s) => s.kind === 'entry');
    const hasExit = j.steps.some((s) => s.kind === 'exit');
    if (!hasEntry || !hasExit) {
      const missing = [];
      if (!hasEntry) missing.push('entry');
      if (!hasExit) missing.push('exit');
      defective.push(`${j.id} (missing ${missing.join(' and ')})`);
    }
  }
  if (defective.length > 0) {
    return {
      id: 'discovery:journeyPresent',
      state: 'fail',
      why: `every journey must declare at least one entry and one exit step: ${defective.join(', ')}.`,
      failingIds: defective.map((d) => d.split(' ')[0]),
    };
  }
  return { id: 'discovery:journeyPresent', state: 'pass', why: '' };
}

/**
 * discovery:stepsNameScreens - every step.screenId resolves to a
 * Screen in the record.
 *
 * The record validator refuses an unknown screenId at the write path,
 * so a persisted record normally cannot fail this check; it stays in
 * the catalogue so a hand-edited file (never meant to happen but worth
 * reporting rather than crashing) is caught here with a readable
 * message rather than deeper inside the wireframe scan.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @returns {CheckResult}
 */
function checkStepsNameScreens(record) {
  const screenIds = new Set(record.screens.map((s) => s.id));
  const broken = [];
  for (const j of record.journeys) {
    for (const step of j.steps) {
      if (!screenIds.has(step.screenId)) {
        broken.push(`${step.id} -> ${step.screenId}`);
      }
    }
  }
  if (broken.length > 0) {
    return {
      id: 'discovery:stepsNameScreens',
      state: 'fail',
      why: `every step must name a declared Screen: ${broken.join(', ')}.`,
      failingIds: broken.map((b) => b.split(' ')[0]),
    };
  }
  return { id: 'discovery:stepsNameScreens', state: 'pass', why: '' };
}

/**
 * discovery:reachable - every step reachable from an entry (BFS over
 * next AND returnsTo edges) and no non-exit step is a dead end.
 *
 * The dead-end check has a distinct why from the unreachable check so
 * AC-18903-6 passes: a step that is unreachable AND a dead end could
 * otherwise reduce to one message that reads as either problem.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @returns {CheckResult}
 */
function checkReachable(record) {
  const deadEnds = [];
  const unreachable = [];
  for (const j of record.journeys) {
    // Dead ends: a non-exit step with no next and no returnsTo. An
    // interruption that has returnsTo set is not a dead end even
    // though its next may be empty. Reported per journey.
    for (const step of j.steps) {
      if (step.kind === 'exit') continue;
      const hasNext = Array.isArray(step.next) && step.next.length > 0;
      const hasReturnsTo = typeof step.returnsTo === 'string' && step.returnsTo.length > 0;
      if (!hasNext && !hasReturnsTo) {
        deadEnds.push(step.id);
      }
    }
    // Reachability: BFS over next and returnsTo from every entry step.
    const stepById = new Map(j.steps.map((s) => [s.id, s]));
    const seen = new Set();
    const queue = [];
    for (const s of j.steps) {
      if (s.kind === 'entry') { seen.add(s.id); queue.push(s.id); }
    }
    while (queue.length > 0) {
      const id = queue.shift();
      const step = stepById.get(id);
      if (!step) continue;
      const edges = [];
      if (Array.isArray(step.next)) edges.push(...step.next);
      if (typeof step.returnsTo === 'string' && step.returnsTo.length > 0) edges.push(step.returnsTo);
      for (const to of edges) {
        if (!seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    for (const s of j.steps) {
      if (!seen.has(s.id)) unreachable.push(s.id);
    }
  }
  if (deadEnds.length > 0 || unreachable.length > 0) {
    const parts = [];
    if (deadEnds.length > 0) parts.push(`dead-end step(s) with no next and no returnsTo: ${deadEnds.join(', ')}`);
    if (unreachable.length > 0) parts.push(`step(s) no entry reaches: ${unreachable.join(', ')}`);
    return {
      id: 'discovery:reachable',
      state: 'fail',
      why: parts.join('; '),
      failingIds: [...deadEnds, ...unreachable],
    };
  }
  return { id: 'discovery:reachable', state: 'pass', why: '' };
}

/**
 * discovery:interruptions - every catalogue entry is either covered
 * by a step of any kind in a journey, or ruled out as
 * notApplicable:<reason> with a reason body of at least
 * NOT_APPLICABLE_REASON_FLOOR characters.
 *
 * The record validator ensures interruption values are a string that
 * either names a step id in that journey or starts
 * 'notApplicable:'. This check adds the reason-body floor and the
 * coverage requirement across every journey.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @returns {CheckResult}
 */
function checkInterruptions(record) {
  const problems = [];
  const failingIds = [];
  for (const j of record.journeys) {
    const answers = j.interruptions && typeof j.interruptions === 'object' ? j.interruptions : {};
    for (const entry of INTERRUPTION_CATALOGUE_V1) {
      const value = answers[entry];
      if (value === undefined || value === null) {
        problems.push(`${j.id}/${entry} unanswered`);
        failingIds.push(`${j.id}/${entry}`);
        continue;
      }
      if (typeof value !== 'string') {
        problems.push(`${j.id}/${entry} value must be a string`);
        failingIds.push(`${j.id}/${entry}`);
        continue;
      }
      if (value.startsWith('notApplicable:')) {
        const reason = value.slice('notApplicable:'.length);
        if (reason.length < NOT_APPLICABLE_REASON_FLOOR) {
          problems.push(`${j.id}/${entry} notApplicable reason too short (needs >= ${NOT_APPLICABLE_REASON_FLOOR} chars, got ${reason.length})`);
          failingIds.push(`${j.id}/${entry}`);
        }
        continue;
      }
      // Any other string is a step id (the record validator proves
      // this). The AC admits "a step of any kind" so no kind
      // restriction is applied here.
    }
  }
  if (problems.length > 0) {
    return {
      id: 'discovery:interruptions',
      state: 'fail',
      why: `interruption catalogue not fully answered: ${problems.join('; ')}.`,
      failingIds,
    };
  }
  return { id: 'discovery:interruptions', state: 'pass', why: '' };
}

/**
 * discovery:wireframePerStep - central only. Every step's Screen must
 * carry a wireframe path and the bytes must exist on disk (the
 * caller signals disk presence by including the path in `wireframes`).
 *
 * For light the check folds to notApplicable with a reason, so AC-3's
 * "the same check reports notApplicable" branch passes.
 *
 * We do NOT inspect `wireframes` here beyond "is this path a key?":
 * the format and self-contained checks each handle their own bytes.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @param {'none' | 'light' | 'central' | null} ui
 * @returns {CheckResult}
 */
function checkWireframePerStepFor(record, ui) {
  if (ui !== 'central') {
    return {
      id: 'discovery:wireframePerStep',
      state: 'notApplicable',
      why: 'wireframes are optional on a light product; a missing wireframe never fails any check.',
      failingIds: [],
    };
  }
  const screenById = new Map(record.screens.map((s) => [s.id, s]));
  const missing = [];
  for (const j of record.journeys) {
    for (const step of j.steps) {
      const screen = screenById.get(step.screenId);
      if (!screen) continue; // stepsNameScreens will report this.
      if (!screen.wireframe) {
        missing.push(`${step.id} (@${screen.slug})`);
      }
    }
  }
  if (missing.length > 0) {
    return {
      id: 'discovery:wireframePerStep',
      state: 'fail',
      why: `central product: every step needs a wireframe on Screen.wireframe: ${missing.join(', ')}.`,
      failingIds: missing.map((m) => m.split(' ')[0]),
    };
  }
  return { id: 'discovery:wireframePerStep', state: 'pass', why: '' };
}

/**
 * discovery:wireframeFormat - every Screen.wireframe path has an
 * admitted extension and, when .png, the record is asBuilt true.
 *
 * Runs regardless of ui (central or light): AC-18903-8 names "on a
 * light product as on a central one". A screen with no wireframe
 * (light) simply does not contribute to this check.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @returns {CheckResult}
 */
function checkWireframeFormatAll(record) {
  const failing = [];
  const failingIds = [];
  for (const screen of record.screens) {
    if (!screen.wireframe) continue;
    const ext = extname(basename(screen.wireframe)).toLowerCase();
    const verdict = checkWireframeFormat({ extension: ext, asBuilt: record.asBuilt });
    if (!verdict.ok) {
      const rule = verdict.rule === 'pngOnlyAsBuilt'
        ? 'png is accepted only on a record declared as-built (rcf discover journey declare --as-built)'
        : 'wireframe extension must be .md, .html or .png';
      failing.push(`${screen.wireframe} (${rule})`);
      failingIds.push(screen.id);
    }
  }
  if (failing.length > 0) {
    return {
      id: 'discovery:wireframeFormat',
      state: 'fail',
      why: failing.join('; '),
      failingIds,
    };
  }
  return { id: 'discovery:wireframeFormat', state: 'pass', why: '' };
}

/**
 * discovery:wireframeSelfContained - every .html wireframe is scanned
 * for external URLs (href, src, srcset attribute values; CSS url()
 * and @import targets) and refused if any value starts http:, https:
 * or //. The first offending URL is reported.
 *
 * Only .html files are scanned; .md and .png are byte-hashed only.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @param {Map<string, WireframeBytes>} wireframes
 * @returns {CheckResult}
 */
function checkWireframeSelfContainedAll(record, wireframes) {
  const failing = [];
  const failingIds = [];
  for (const screen of record.screens) {
    if (!screen.wireframe) continue;
    const ext = extname(basename(screen.wireframe)).toLowerCase();
    if (ext !== '.html') continue;
    const entry = wireframes.get(screen.wireframe);
    if (!entry || typeof entry.text !== 'string') continue;
    const offending = scanHtmlForExternalUrls(entry.text);
    if (offending !== null) {
      failing.push(`${screen.wireframe} -> ${offending}`);
      failingIds.push(screen.id);
    }
  }
  if (failing.length > 0) {
    return {
      id: 'discovery:wireframeSelfContained',
      state: 'fail',
      why: `html wireframe(s) carry an external URL: ${failing.join('; ')}.`,
      failingIds,
    };
  }
  return { id: 'discovery:wireframeSelfContained', state: 'pass', why: '' };
}
