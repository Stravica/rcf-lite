// Minimal Worker entry for the cf-platform fixture. Serves a plain
// text response on the root path so the wrangler dev boot is
// self-verifying; every other path falls through to the static
// assets pipeline configured under wrangler.toml [assets].

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
