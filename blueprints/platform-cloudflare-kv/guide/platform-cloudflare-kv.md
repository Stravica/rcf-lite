# platform-cloudflare-kv: the shipped shape

This guide is the two-to-three-screen orientation for a developer
about to apply `platform-cloudflare-kv` on a Cloudflare Workers
project. It complements the README (interface reference) and the
CHANGELOG (version history).

## When to reach for KV

Cloudflare Workers KV is a global, low-latency key-value store
(<https://developers.cloudflare.com/kv/>). It is the shipped answer
for:

- Feature flags and small configuration blobs read from every edge
  request.
- Session or token caches where a per-request read latency matters
  more than the write-appearing-instantly-everywhere guarantee.
- Read-through caches over a slower origin (a database, a downstream
  API) where a 60-second staleness ceiling is acceptable.

KV is NOT the shipped answer when:

- Every read must reflect the most recent write (KV is eventually
  consistent).
- A single key must have one authoritative owner across the fleet
  (needs a coordinator, not a global cache).
- The value is mutated by concurrent writers who each expect their
  write to win in a total order.

Those three cases point at Durable Objects: the round-6 T-3 sibling
`platform-cloudflare-durable-objects` is the shipped answer for
strong-consistency needs.

## The eventual-consistency note

Workers KV is documented as eventually consistent
(<https://developers.cloudflare.com/kv/concepts/how-kv-works/>). Two
practical consequences the guide surfaces:

1. A write made in one Cloudflare location is usually immediately
   visible on a same-location read, but not guaranteed to be. On a
   different location, changes may take up to 60 seconds or more to
   be visible as cached versions time out.
2. Negative lookups (indicating a key does not exist) are also
   cached, creating similar delays when discovering newly created
   values.

The elicited cache-aside TTL (default 60 seconds per ADR-3202)
aligns the cache-aside staleness ceiling with the Cloudflare cache
TTL default so two clocks are one clock. A project that needs
tighter staleness re-elicits with a smaller TTL; a project that
needs looser staleness re-elicits with a larger TTL. The TTL floor
(1 second) is enforced by the cache-aside helper so a misconfigured
project cannot ship a sub-second TTL.

## Decision tree: KV, Durable Objects, or something else

- Reads dominate writes AND a global staleness ceiling of a few
  seconds is acceptable AND writes come from few writers -> `platform-cloudflare-kv`.
- Reads mix with writes AND every read must reflect the most recent
  write AND one key has one authoritative owner -> `platform-cloudflare-durable-objects` (round-6 T-3).
- Row-shaped relational data with SQL semantics ->
  `persistence-data-postgres` or `persistence-data-d1` (via
  `persistenceStore`).
- Large binary uploads or reports -> `object-storage-s3` (via
  `objectStorage`).

## Applying the blueprint

1. Answer the elicited prompts at apply time:
   - `kv-binding-name`: the binding name the Worker sees on `env`.
     Default `CACHE`.
   - `kv-default-cache-ttl-seconds`: the cache-aside default TTL.
     Default `60`, floor `1`, no upper ceiling imposed by the
     helper.
   - `kv-metadata-field-pattern`: recommended default `{v: number}`
     for a per-key schema version marker.
   - `kv-key-naming-convention`: `prefixed` (recommended) or
     `flat` per ADR-3203.

2. Create a KV namespace via `wrangler`:

   ```
   npx wrangler kv namespace create <kv-binding-name>
   ```

   Copy the returned `id` and `preview_id` into
   `wrangler.toml` under `[[kv_namespaces]]`; the shipped fixture
   uses placeholder ids so `wrangler dev` boots without a live
   namespace.

3. Import the facade at your app boundary; construct once, pass
   into request handlers:

   ```js
   import { createKvFacade } from './src/kv-facade.mjs';
   import { createCacheAside } from './src/cache-aside.mjs';

   const facade = createKvFacade({
     binding: env.CACHE,
     eventSink: emit,
     defaultCacheTtl: 60,
   });
   const cache = createCacheAside({ facade, defaultTtl: 60 });
   ```

4. Consume the typed verbs:

   ```js
   const cached = await cache.getOr('flags/feature-1', async () => {
     const fresh = await fetchFromOrigin();
     return fresh;
   });
   ```

## The event-sink boundary

Every KV operation emits a metadata-only lifecycle event on the
injected sink: `facadeReady`, `kvHit`, `kvMiss`, `kvWrite`. Each
record carries EXACTLY `{event, key, size, ttl, timestamp}` and
nothing else: no body bytes, no metadata pass-through, no user id
beyond the key itself. The event-secrecy probe drives this at
mechanism reach with a PII fixture body; the shipped facade passes
cleanly and a mutation-run under `SIMULATE_PII_LEAK` trips the
probe to fail.

Wire the sink into the applied logging companion (`observability-
logging`) so the events render into the log stream without a body
byte ever leaving the facade.

## Standards references

- <https://developers.cloudflare.com/kv/> (Workers KV overview)
- <https://developers.cloudflare.com/kv/api/> (binding API)
- <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
  (consistency model, default cache TTL)
- <https://developers.cloudflare.com/kv/platform/limits/> (documented
  per-namespace limits, the vendor ceiling above the shipped TTL)
