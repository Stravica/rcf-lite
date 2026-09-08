// Cache-aside hit-then-miss probe for platform-cloudflare-kv
// v1.0.0.
//
// Drives the cache-aside helper against the fixture facade under
// an elicited deterministic clock the fixture advances:
//
//   1) First getOr(key, origin): miss, origin invoked, writeback,
//      counter=1.
//   2) Second getOr within TTL: hit, origin NOT invoked, counter
//      still 1.
//   3) Advance clock past TTL, third getOr: miss, origin invoked
//      again, counter=2.
//
// The mutation-run that disables the writeback path (put becomes a
// no-op so the second read misses the cache and re-invokes origin)
// is provided by the fixture-side H-2 shim (h2-cf-kv-cache-aside-
// shim.mjs, reads cache-miss internally); the probe body
// holds no mutation-switch read of its own (AC-15401-1 mutation-purity
// rule, brief section 5).
//
// anchorAcId: AC-31105-1 (primary: within-TTL cached branch per
//   US-31105). Additional result covers AC-31106-1 (past-TTL miss
//   branch per US-31106).
// accountBound: false.

export const anchorAcId = 'AC-31105-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createCacheAside } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/cache-aside.mjs');
  const { createCacheAsideFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-cache-aside-shim.mjs');

  let now = 1_000_000_000_000;
  const clock = () => now;

  const binding = createInMemoryKv({ clock });
  const { facade, mutationOn } = createCacheAsideFacade({ binding, eventSink: () => {} });

  const cache = createCacheAside({ facade, defaultTtl: 5 });

  let originCalls = 0;
  const origin = async () => {
    originCalls += 1;
    return `origin-value-${originCalls}`;
  };

  const key = 'cache-aside/hit-then-miss';

  const first = await cache.getOr(key, origin);
  const second = await cache.getOr(key, origin);
  now += 6 * 1000; // advance the elicited clock past the 5-second TTL
  const third = await cache.getOr(key, origin);

  const results = [];

  const withinTtlPass = originCalls >= 1 && second.source === 'cache' && first.value === second.value;
  results.push({
    anchorAcId: 'AC-31105-1',
    verdict: mutationOn
      ? 'fail'
      : (withinTtlPass ? 'pass' : 'fail'),
    detail: mutationOn
      ? `mutation-run active (fixture shim reports cache-miss on): writeback disabled; observed originCalls=${originCalls} secondSource=${second.source} (expected 1 and cache under the shipped code path)`
      : (withinTtlPass
        ? `first miss then cached: originCalls=${originCalls} secondSource=${second.source}`
        : `within-TTL branch fault: originCalls=${originCalls} secondSource=${second.source}`),
  });

  const pastTtlPass = originCalls === 2 && third.source === 'origin';
  results.push({
    anchorAcId: 'AC-31106-1',
    verdict: mutationOn ? 'fail' : (pastTtlPass ? 'pass' : 'fail'),
    detail: mutationOn
      ? `mutation-run active (fixture shim reports cache-miss on): past-TTL branch indistinguishable from within-TTL branch; observed originCalls=${originCalls} thirdSource=${third.source}`
      : (pastTtlPass
        ? `past-TTL read triggered origin: originCalls=${originCalls} thirdSource=${third.source}`
        : `past-TTL branch fault: originCalls=${originCalls} thirdSource=${third.source}`),
  });

  return { results };
}
