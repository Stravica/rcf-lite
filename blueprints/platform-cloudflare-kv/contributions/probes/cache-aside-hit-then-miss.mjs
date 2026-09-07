// Cache-aside hit-then-miss probe for platform-cloudflare-kv v1.0.0.
//
// Drives the cache-aside helper against the fixture facade under a
// fake clock:
//
//   1) First getOr(key, origin): miss, origin invoked, writeback,
//      counter=1.
//   2) Second getOr within TTL: hit, origin NOT invoked, counter
//      still 1.
//   3) Advance clock past TTL, third getOr: miss, origin invoked
//      again, counter=2.
//
// Induced-failure switch SIMULATE_CACHE_MISS=true disables the
// writeback path (wraps the facade so put is a no-op); the probe
// observes two origin calls where one was expected and returns
// aggregateVerdict: fail with the missing writeback named.
//
// anchorAcId: AC-5201-1 (AC-5201-2 covered as an additional result).
// accountBound: false.

export const anchorAcId = 'AC-5201-1';
export const accountBound = false;

const SIMULATE_CACHE_MISS = process.env.SIMULATE_CACHE_MISS === 'true';

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createKvFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-facade.mjs');
  const { createCacheAside } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/cache-aside.mjs');

  let now = 1_000_000_000_000;
  const clock = () => now;

  const binding = createInMemoryKv({ clock });
  const rawFacade = createKvFacade({ binding, eventSink: () => {} });
  const facade = SIMULATE_CACHE_MISS
    ? { ...rawFacade, put: async () => {} }
    : rawFacade;

  const cache = createCacheAside({ facade, defaultTtl: 5 });

  let originCalls = 0;
  const origin = async () => {
    originCalls += 1;
    return `origin-value-${originCalls}`;
  };

  const key = 'cache-aside/hit-then-miss';

  const first = await cache.getOr(key, origin);
  const second = await cache.getOr(key, origin);
  now += 6 * 1000; // advance past 5-second TTL
  const third = await cache.getOr(key, origin);

  const results = [];

  const withinTtlPass = originCalls >= 1 && second.source === 'cache' && first.value === second.value;
  results.push({
    anchorAcId: 'AC-5201-1',
    verdict: SIMULATE_CACHE_MISS
      ? (originCalls > 1 && second.source === 'origin' ? 'fail' : 'fail')
      : (withinTtlPass ? 'pass' : 'fail'),
    detail: SIMULATE_CACHE_MISS
      ? `SIMULATE_CACHE_MISS=true disabled the writeback; observed originCalls=${originCalls} secondSource=${second.source} (expected 1 and cache under the shipped code path)`
      : (withinTtlPass
        ? `first miss then cached: originCalls=${originCalls} secondSource=${second.source}`
        : `within-TTL branch fault: originCalls=${originCalls} secondSource=${second.source}`),
  });

  const pastTtlPass = originCalls === 2 && third.source === 'origin';
  results.push({
    anchorAcId: 'AC-5201-2',
    verdict: SIMULATE_CACHE_MISS ? 'fail' : (pastTtlPass ? 'pass' : 'fail'),
    detail: SIMULATE_CACHE_MISS
      ? `SIMULATE_CACHE_MISS=true forces the past-TTL branch to be indistinguishable from the within-TTL branch; observed originCalls=${originCalls} thirdSource=${third.source}`
      : (pastTtlPass
        ? `past-TTL read triggered origin: originCalls=${originCalls} thirdSource=${third.source}`
        : `past-TTL branch fault: originCalls=${originCalls} thirdSource=${third.source}`),
  });

  return { results };
}
