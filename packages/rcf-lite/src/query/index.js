// Public surface for the query layer (Phase 5 §D16). Pure logic +
// formatters; handlers live under `src/cli/`.

export { computeCoverage, classifyCoverageScope } from './coverage.js';
export { computeTrace, kindOf } from './trace.js';
export { computeImpact, labelFor } from './impact.js';
export { formatTable } from './formatters/table.js';
export { formatJson } from './formatters/json.js';
export { formatMermaid } from './formatters/mermaid.js';
// 0.8.0 slug-train car 3: NV-BL-SR-03 addendum (ruling-sheet item 1)
// -- traceability / query tools share the refuse-first posture that
// gates rcf build. Callers wrap their query producer with this.
export { runWithAdmissibilityGate } from './refuse-on-admissibility.js';
