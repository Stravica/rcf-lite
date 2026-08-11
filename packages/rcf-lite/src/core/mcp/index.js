// RCF-agnostic MCP protocol shell — the shared surface both build-lite and
// verify-lite build their domain MCP adapters on. This barrel re-exports the
// pure protocol lifecycle (server.js) and the newline-delimited JSON-RPC
// framing (framing.js). Neither module knows anything about RCF; domain
// behaviour arrives through the injected `handlers` map (see server.js).

export * from './server.js';
export * from './framing.js';
