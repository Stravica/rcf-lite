// Minimal Worker entry for the cf-platform fixture. Serves a plain
// text response on the root path so the wrangler dev boot is
// self-verifying; every other path falls through to the static
// assets pipeline configured under wrangler.toml [assets].
//
// The KV binding is intentionally NOT dereferenced here: per
// platform-cloudflare-kv REQ-001, the KV facade module
// (src/kv-facade.mjs) is the SOLE reader of the binding on the
// applied project. Same discipline for the T-3 Durable Objects
// bindings env.CELL and env.HUB: the DO facade module
// (src/do-facade.mjs) is the SOLE reader per REQ-070. This entry
// module never dereferences either DO binding or the KV binding.
//
// The T-3 DO classes are re-exported from this module so wrangler
// dev resolves `class_name = "SingleCellObject"` and `class_name =
// "HubObject"` on the [[durable_objects.bindings]] blocks without
// a separate class-file discovery step per Cloudflare's runtime
// contract (https://developers.cloudflare.com/durable-objects/).

export { SingleCellObject } from './do-single-cell.mjs';
export { HubObject } from './do-hub.mjs';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('cf-platform Worker fixture is up.\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('not found', { status: 404 });
  },
};
