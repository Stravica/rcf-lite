// Public surface for the query layer (Phase 5 §D16). Pure logic +
// formatters; handlers live under `src/cli/`.

export { computeCoverage, classifyCoverageScope } from './coverage.js';
export { computeTrace, kindOf } from './trace.js';
export { computeImpact, labelFor } from './impact.js';
// Detection model (REQ-172, proposal 2026-09-22 §2.2 v3). Pure hashes
// over the parsed tree; every downstream DEFINE gate reads this delta.
export {
  canonicaliseJson,
  hashDocument,
  computeTreeHash,
  computeDelta,
} from './delta.js';
// DEFINE stage gates (REQ-174; proposal §2.4, §3.2 v3). One check
// function per stage; foldState + parseAcClass helpers.
export {
  STAGE_ORDER,
  STAGE_GATES,
  STAGE_SHORT_NAMES,
  STAGE_ALIASES,
  INTERFACE_KINDS,
  stagePolicy,
  parseAcClass,
  foldState,
  runStage,
  checkD1Brief,
  checkD2Skeleton,
  checkD3Shapes,
  checkD4Stories,
  checkD5Crosscut,
  checkD6Consistency,
  checkD7Decisions,
  checkD8Freeze,
} from './gates.js';
// Readiness composer (REQ-175; proposal §2.4, §6 v3).
export {
  computeReadiness,
  deriveNextAction,
  shortHash,
  formatTreeLine,
} from './readiness.js';
export { formatTable } from './formatters/table.js';
export { formatJson } from './formatters/json.js';
export { formatMermaid } from './formatters/mermaid.js';
// 0.8.0 slug-train car 3: NV-BL-SR-03 addendum (ruling-sheet item 1)
// -- traceability / query tools share the refuse-first posture that
// gates rcf build. Callers wrap their query producer with this.
export { runWithAdmissibilityGate } from './refuse-on-admissibility.js';
