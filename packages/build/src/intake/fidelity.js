// Intake-fidelity classifier (spec §3.7, §6.4 phase 1).
//
// Deterministic word-count + signal-count classifier over the raw text of
// a supplied artefact. The bands are the ones the spec ratified:
//   none        → nothing supplied (caller passes an empty artefact list)
//   napkin      → very short: one paragraph or a sketchy note
//   briefLight  → short brief: names problem and capabilities, unstated NFRs
//   briefStrong → full product brief with capabilities enumerated, NFRs named,
//                 out-of-scope called out. The watchpost brief lives here.
//   prd         → a full PRD or PRD-adjacent doc (front-matter, requirement
//                 sections, acceptance-shaped bullets)
//   prdPlusTad  → a PRD plus a TAD (architecture, ADR, TAC signals)
//
// The classifier is not a scoring engine; it uses cheap keyword signals
// (headings, capability lists, NFR keywords, out-of-scope markers,
// architecture markers) plus word count to assign a band. The operator
// always confirms the verdict at phase-1 handoff.

export const FIDELITY_LEVELS = Object.freeze([
  'none',
  'napkin',
  'briefLight',
  'briefStrong',
  'prd',
  'prdPlusTad',
]);

const CAP_HEADINGS = /^(?:\s*#+\s*)(?:capabilit(?:y|ies)|must-have|should-have|features?|user story|user stories|acceptance criteria)\b/im;
const NFR_HEADINGS = /^(?:\s*#+\s*)(?:non[-\s]?functional|nfr|constraints?|performance|reliability|security|scalability|budgets?)\b/im;
const OUT_OF_SCOPE = /^(?:\s*#+\s*)?(?:out[-\s]?of[-\s]?scope|non[-\s]?goals?|will not do|not (?:in|for) v[0-9])\b/im;
const REQ_MARKERS = /^\s*(?:REQ|US|AC)-?[0-9]+/im;
const PRD_MARKERS = /^(?:\s*#+\s*)?(?:product\s+requirements\s+document|prd|problem statement|users?\s*&?\s*personas?)\b/im;
const TAD_MARKERS = /^(?:\s*#+\s*)?(?:technical\s+architecture|architecture decision record|adr[-\s]?[0-9]+|tac[-\s]?[0-9]+|system architecture|component diagram|api boundaries)\b/im;

/**
 * @typedef {'none'|'napkin'|'briefLight'|'briefStrong'|'prd'|'prdPlusTad'} FidelityBand
 */

/**
 * @typedef {object} FidelitySignals
 * @property {number} wordCount
 * @property {boolean} capabilitiesEnumerated
 * @property {boolean} nfrsNamed
 * @property {boolean} outOfScopeListed
 * @property {boolean} requirementMarkers
 * @property {boolean} prdShape
 * @property {boolean} tadShape
 */

/**
 * Classify one artefact into a fidelity band. Accepts null/empty text
 * ("nothing supplied").
 *
 * @param {string|null} text
 * @param {object} [opts]
 * @param {string|null} [opts.kindHint]  operator hint: napkin|productBrief|prd|prdPlusTad|other
 * @returns {{ fidelity: FidelityBand, signals: FidelitySignals }}
 */
export function classifyFidelity(text, opts = {}) {
  const hint = opts.kindHint ?? null;
  const t = typeof text === 'string' ? text : '';
  const wordCount = t.trim().length === 0 ? 0 : t.trim().split(/\s+/).length;
  const signals = {
    wordCount,
    capabilitiesEnumerated: CAP_HEADINGS.test(t),
    nfrsNamed: NFR_HEADINGS.test(t),
    outOfScopeListed: OUT_OF_SCOPE.test(t),
    requirementMarkers: REQ_MARKERS.test(t),
    prdShape: PRD_MARKERS.test(t),
    tadShape: TAD_MARKERS.test(t),
  };

  // Operator hint takes precedence when it is explicit and unambiguous.
  if (hint === 'napkin') return { fidelity: 'napkin', signals };
  if (hint === 'prd') return { fidelity: 'prd', signals };
  if (hint === 'prdPlusTad') return { fidelity: 'prdPlusTad', signals };

  if (wordCount === 0) return { fidelity: 'none', signals };

  // Structural markers (PRD / TAD / requirement ids) win over the word
  // count band: an operator supplying an already-structured short doc
  // (a partial PRD, an ADR, a REQ-ids list) is at the prd/prdPlusTad
  // band regardless of length.
  if (signals.tadShape && (signals.prdShape || signals.requirementMarkers)) {
    return { fidelity: 'prdPlusTad', signals };
  }
  if (signals.tadShape) return { fidelity: 'prdPlusTad', signals };
  if (signals.requirementMarkers || (signals.prdShape && signals.capabilitiesEnumerated)) {
    return { fidelity: 'prd', signals };
  }

  if (wordCount < 100) return { fidelity: 'napkin', signals };

  // Brief band: capabilities enumerated + NFRs named + out-of-scope
  // listed → briefStrong; otherwise briefLight.
  if (signals.capabilitiesEnumerated && signals.nfrsNamed && signals.outOfScopeListed) {
    return { fidelity: 'briefStrong', signals };
  }
  if (signals.capabilitiesEnumerated || signals.nfrsNamed || signals.outOfScopeListed) {
    return { fidelity: 'briefLight', signals };
  }
  // Default: prose of some length but no signals — treat as napkin
  // upgraded to briefLight over 400 words.
  return { fidelity: wordCount >= 400 ? 'briefLight' : 'napkin', signals };
}
