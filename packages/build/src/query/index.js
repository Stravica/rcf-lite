// Public surface for the query layer (Phase 5 §D16). Pure logic +
// formatters; handlers live under `src/cli/`.

export { computeCoverage, classifyCoverageScope } from './coverage.js';
export { computeTrace, kindOf } from './trace.js';
export { computeImpact, labelFor } from './impact.js';
export { formatTable } from './formatters/table.js';
export { formatJson } from './formatters/json.js';
export { formatMermaid } from './formatters/mermaid.js';
