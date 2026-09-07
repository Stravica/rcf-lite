// Cache-aside helper per REQ-003. Wraps a domain-origin call with a
// KV read: on hit, returns the cached value; on miss, invokes the
// origin function, writes back through the facade with the elicited
// TTL (floor 1 second per ADR-3202), and returns the fresh value.
//
// The facade is injected; the helper never dereferences the KV
// binding itself. TTL floor is enforced here so a misconfigured
// project cannot ship a TTL below one second at this seam.

export const CACHE_ASIDE_TTL_FLOOR_SECONDS = 1;

export function createCacheAside({ facade, defaultTtl }) {
  if (!facade) throw new Error('cache-aside: facade is required');
  const ttl = typeof defaultTtl === 'number' ? Math.max(defaultTtl, CACHE_ASIDE_TTL_FLOOR_SECONDS) : 60;

  async function getOr(key, originFn, options = {}) {
    const perCallTtl = typeof options.ttl === 'number' ? Math.max(options.ttl, CACHE_ASIDE_TTL_FLOOR_SECONDS) : ttl;
    const cached = await facade.get(key);
    if (cached !== null) {
      return { value: cached, source: 'cache' };
    }
    const fresh = await originFn();
    await facade.put(key, typeof fresh === 'string' ? fresh : JSON.stringify(fresh), { ttl: perCallTtl });
    return { value: fresh, source: 'origin' };
  }

  return { getOr, effectiveTtl: ttl };
}
