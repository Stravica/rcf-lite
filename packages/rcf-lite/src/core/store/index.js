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
// w-2026-07-28-005: Test Case pointer working-tree resolution (test-axis
// twin of cn-resolve). Coverage consumes this - an unresolved pointer is
// never counted as covering an AC.
export { resolveTestPointers, splitTestPointer, testCaseKey } from './tp-resolve.js';
export { nextIdForKind, createDocument, updateDocument, deleteDocument, deriveSlug } from './writer.js';
// 0.28.2 (issues #230/#232 + review/ui-baseline init/browser-verify):
// shared "compose then schema-validate without writing" helper the
// dry-run branches of the five discover verbs run so a preview reports
// the same schema error the writer would refuse on.
export { validateComposedRecord, buildNextManifest } from './validate-composed-record.js';
