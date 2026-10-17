// Preload for the FBS-220 end-to-end tests. Loaded with `node --import
// <this file>` in the child running bin/rcf.js. A hosts-style override for
// the verifier's probes: RCF_TEST_HOST_MAP holds `name=host:port` pairs
// (comma separated), and every globalThis.fetch to a mapped hostname is
// sent to the mapped loopback address instead. The URL the run records
// (report target.url) keeps the non-loopback name, as a preview host would.
const map = new Map(
  (process.env.RCF_TEST_HOST_MAP ?? '').split(',').filter(Boolean).map((pair) => pair.split('=')),
);

if (map.size > 0 && typeof globalThis.fetch === 'function') {
  const original = globalThis.fetch;
  globalThis.fetch = function mappedFetch(input, init) {
    const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(href);
    const to = map.get(url.hostname);
    if (!to) return original.call(this, input, init);
    const rewritten = new URL(`${url.pathname}${url.search}`, `${url.protocol}//${to}`);
    return original.call(this, rewritten, init);
  };
}
