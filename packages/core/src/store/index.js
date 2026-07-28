// Document store - public surface for the Phase 3 dispatch.
//
// Every consumer (the view, future CLI verbs, future MCP tools) reaches the
// filesystem through this module. No other layer reads from or writes to
// rcf/ directly.

export { loadDocument, loadRootDocument, pathForId, rootPathFor, subdirFor } from './loader.js';
// w-2026-07-28-017: id identity (leading-zero-tolerant). Shared by the
// walker's globallyUniqueIds rule and the writer's allocator.
export { idNumber, normaliseId, sameId } from './ids.js';
export { validateDocument, idFieldFor, documentIdOf, knownKinds } from './validator.js';
export { netNewErrors, simulateWriteErrors, walkTree } from './walker.js';
export { initProject } from './init.js';
// Phase 10 (X2 CodeNode bridge): Code Node working-tree staleness check.
export { checkCodeNodeResolution, splitCnPath } from './cn-resolve.js';
export { nextIdForKind, createDocument, updateDocument, deleteDocument, deriveSlug } from './writer.js';
