// Document store - public surface for the Phase 3 dispatch.
//
// Every consumer (the view, future CLI verbs, future MCP tools) reaches the
// filesystem through this module. No other layer reads from or writes to
// rcf/ directly.

export { loadDocument, loadRootDocument, pathForId, rootPathFor, subdirFor } from './loader.js';
export { validateDocument, idFieldFor, documentIdOf, knownKinds } from './validator.js';
export { walkTree } from './walker.js';
export { initProject } from './init.js';
