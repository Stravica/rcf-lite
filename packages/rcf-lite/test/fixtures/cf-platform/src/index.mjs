// Minimal Worker entry for the cf-platform fixture. Serves a plain
// text response on the root path so the wrangler dev boot is
// self-verifying; every other path falls through to the static
// assets pipeline configured under wrangler.toml [assets].
//
// The KV binding is intentionally NOT dereferenced here: per
// platform-cloudflare-kv REQ-001, the KV facade module
// (src/kv-facade.mjs) is the SOLE reader of the binding on the
// applied project. A consumer request handler wires the facade
// factory at its own top-level, hands the returned facade to the
// domain code, and never touches the raw binding directly.

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
