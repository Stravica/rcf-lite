// Public surface for the blueprint mechanism.

export { applyBlueprint } from './apply.js';
export { listBlueprints, enrichRowsWithCategories, groupRowsByCategory } from './list.js';
export { removeBlueprint } from './remove.js';
export { removeResolution } from './remove-resolution.js';
export { loadBlueprint } from './loader.js';
export { detectGlobalAdrConflicts, detectCrossBlueprintClaims, renderConflictReport, conflictReportJson } from './conflicts.js';
export { stampId, parseIdParts, namespaceStyleFor, isNamespacedFor } from './namespace.js';
export { registerStandardsPack, listStandards } from './standards.js';
export { nextResolutionId, matchingResolution } from './resolutions.js';
export { supersedeBlueprintTopic } from './supersede.js';
export { diffBlueprintTopic, renderDiff } from './diff.js';
export { resolveBlueprintSource, knownShelfSlugs, packagedShelfPath } from './shelf-resolver.js';
export { loadLibrary } from './library-loader.js';
export {
  COMPANIONS_PATH,
  COMPANIONS_SCHEMA_VERSION,
  readCompanionsFile,
  validateCompanionsFile,
  setCompanionPin,
  unsetCompanionPin,
  enumerateShelfProviders,
  enumerateLibraryProviders,
  enumerateAppliedProviders,
  resolveCompanionRole,
  resolveCompanions,
  renderCompanionLines,
  renderAmbiguousLibraryRefusal,
  validateCompanionPinsResolvable,
} from './companions.js';
export {
  REGISTRY_PATH,
  REGISTRY_VERSION,
  readLibraryRegistry,
  writeLibraryRegistry,
  findLibrary,
  loadCoreBandReservations,
  detectBandOverlap,
  detectContributionsOutOfBand,
  detectPrefixCollision,
} from './library-registry.js';
export {
  CACHE_ROOT,
  absoluteCachePath,
  ensureEmptyCache,
  relativeCachePath,
  removeCache,
  resolveCachePath,
  sanitiseRef,
} from './library-cache.js';
export {
  fetchGitLibrary,
  parseGitRef,
  resolveRemoteSha,
  isFullSha,
  refusedRefs,
} from './library-fetcher-git.js';
export {
  createUstarBuffer,
  fetchTarballLibrary,
  parseUstar,
  sha256Hex,
} from './library-fetcher-tarball.js';
export {
  loadForLint,
  loadSuppressions,
  runLint,
  runPass1,
  runPass2,
} from './consistency-lint.js';
export {
  APPLY_DISPOSITION_PROMPT,
  LEDGER_SCHEMA_NOTE,
  initialiseLedger,
  ledgerAbsPath,
  ledgerExists,
  ledgerRelPath,
  readLedger,
  upsertLedgerRecord,
  writeLedger,
} from './disposition-ledger.js';
export { renderDispositions } from './dispositions.js';
