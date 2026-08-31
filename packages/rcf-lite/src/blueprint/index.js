// Public surface for the blueprint mechanism.

export { applyBlueprint } from './apply.js';
export { listBlueprints, enrichRowsWithCategories, groupRowsByCategory } from './list.js';
export { removeBlueprint } from './remove.js';
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
