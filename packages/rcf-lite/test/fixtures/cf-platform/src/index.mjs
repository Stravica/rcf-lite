// Minimal Worker entry for the cf-platform fixture. Serves a plain
// text response on the root path, forwards Durable Object routes to
// the DO facade, and falls through to the static-assets pipeline
// configured under wrangler.toml [assets] for everything else.
//
// The KV binding is intentionally NOT dereferenced here: per
// platform-cloudflare-kv REQ-001, the KV facade module
// (src/kv-facade.mjs) is the SOLE reader of the binding on the
// applied project. Same discipline for the T-3 Durable Objects
// bindings: the DO facade module (src/do-facade.mjs) is the SOLE
// reader per REQ-070. This entry module never dereferences either
// DO binding or the KV binding directly; every DO call routes
// through the facade's cellFetch / hubFetch helpers.
//
// The T-3 DO classes are re-exported so wrangler dev resolves the
// stable class name strings committed on the [[durable_objects.bindings]]
// blocks per REQ-077 without a separate class-file discovery step.

import { createDoFacade } from './do-facade.mjs';

export { SingleCellObject } from './do-single-cell.mjs';
export { HubObject } from './do-hub.mjs';

function silentSink() {
  // The routing layer does not care about lifecycle events; a
  // production consumer wires this to the applied logging companion.
  return () => {};
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('cf-platform Worker fixture is up.\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    // T-3 wrangler-seam routes: forward to the DO facade so this
    // module never dereferences the DO namespace bindings.
    // /cell/:id/(increment|read|reset) reaches the single-cell shape.
    const cellMatch = url.pathname.match(/^\/cell\/([^/]+)\/(increment|read|reset)$/);
    if (cellMatch) {
      const facade = createDoFacade({ env, eventSink: silentSink() });
      return facade.cellFetch(cellMatch[1], request);
    }
    // /hub/:id/connect opens a WebSocket upgrade to the hub shape.
    const hubMatch = url.pathname.match(/^\/hub\/([^/]+)\/connect$/);
    if (hubMatch) {
      const facade = createDoFacade({ env, eventSink: silentSink() });
      return facade.hubFetch(hubMatch[1], request);
    }
    return new Response('not found', { status: 404 });
  },
};
