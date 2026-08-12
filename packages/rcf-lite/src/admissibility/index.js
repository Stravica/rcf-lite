// Public surface for the chain-admissibility gate (0.8.0 slug-train,
// car 3). Rules consumed from the shared standards ruleset bundled
// inside this umbrella package (`#ruleset`) per the ratified
// requirements doc (2026-08-06 canonical since 2026-08-12).

export { enforceAdmissibility, getRulesetToolScope } from './enforce.js';
export { scanAcScopeCoverage, scanTcScopeVsAc } from './scope-lint.js';
export { scanFilesForMarkers, scanSourceStringForMarkers } from './markers.js';
