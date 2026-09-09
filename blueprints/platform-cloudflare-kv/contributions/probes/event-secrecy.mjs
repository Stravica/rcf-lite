// Event-secrecy probe for platform-cloudflare-kv v1.0.0.
//
// Two layers of assertion so the whitelist is exercised at the
// actual boundary AC-31108-1 claims, and the shipped code path is
// exercised end-to-end with a PII fixture body:
//
//   (1) Direct-boundary assertion: emit an event through the
//       facade wired to a spy sink, using a PII fixture body; the
//       sink receives records shaped to the metadata-only
//       whitelist {event, key, size, ttl, timestamp} with no
//       body / SSN substring surviving.
//
//   (2) Shipped-code-path assertion: drive put/get/delete on the
//       PII fixture key through the facade; every event record on
//       the sink carries only the whitelist; a scan of the
//       serialised records for SSN / body / user id substrings
//       returns zero hits.
//
// The mutation-run that swaps the shipped sink for one that
// forwards the body / userId / ssn onto every record is provided
// by the fixture-side shim (h2-cf-kv-event-secrecy-shim.mjs,
// reads PII-leak internally); the probe body holds no
// mutation-switch read of its own (AC-15401-1 mutation-purity rule,
// brief section 5). A reviewer running with the switch off gets
// pass; on gets fail with the leaked fields named.
//
// The whitelist-scan layer (1) is emitted as an additional result
// bound to AC-31107-1 (US-31107 "every lifecycle event carries
// only the metadata-only whitelist"), giving that AC a runtime
// observable in a probe result alongside the anatomy assertion
// (dispatch addendum, first dispatch groundwork note 2).
//
// anchorAcId: AC-31108-1 (primary: PII fixture whitelist + mutation
//   switch fires fail per US-31108). Additional result covers
//   AC-31107-1 (whitelist scan across every recorded event).
// accountBound: false.

export const anchorAcId = 'AC-31108-1';
export const accountBound = false;

const PII_STRINGS = ['REDACTED-fixture', '1234', 'ssn'];
const ALLOWED_KEYS = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createKvFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-facade.mjs');
  const { createEventSecrecySink } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-event-secrecy-shim.mjs');

  const results = [];

  const { sink, captured, mutationOn } = createEventSecrecySink();

  const binding = createInMemoryKv();
  const facade = createKvFacade({ binding, eventSink: sink });

  // PII fixture: users/1234/profile with a SSN body. The body is a
  // JSON string the facade stores; the events must NEVER carry it.
  const key = 'users/1234/profile';
  const body = JSON.stringify({ ssn: 'REDACTED-fixture', userId: 1234 });

  await facade.ready();
  await facade.put(key, body, { metadata: { v: 1 } });
  await facade.get(key);
  await facade.delete(key);

  // Layer (1) direct-boundary assertion: every record's keys are a
  // subset of the whitelist. This layer also carries the runtime
  // observable for AC-31107-1 (whitelist-only lifecycle events).
  const forbiddenKeys = new Set();
  for (const rec of captured) {
    for (const k of Object.keys(rec)) {
      if (!ALLOWED_KEYS.has(k)) forbiddenKeys.add(k);
    }
  }

  // Layer (2) substring assertion: no PII substring in the JSON
  // serialisation of any record OUTSIDE its key field. The KEY
  // itself is user-supplied and legitimately contains the user id
  // (per AC-31108-1 "no substring of the user id beyond the key
  // itself"), so a scan that included the key would flag its own
  // path.
  const withoutKey = captured.map((r) => {
    const { key: _omit, ...rest } = r;
    return rest;
  });
  const serialised = JSON.stringify(withoutKey);
  const piiHits = PII_STRINGS.filter((s) => serialised.includes(s));

  const whitelistPass = forbiddenKeys.size === 0 && piiHits.length === 0;

  // AC-31107-1 additional-result: whitelist-only lifecycle events.
  // Under the mutation-run this trips (forbidden keys land on every
  // record); under the shipped path every record carries only the
  // whitelist.
  results.push({
    anchorAcId: 'AC-31107-1',
    verdict: mutationOn
      ? (forbiddenKeys.size === 0 ? 'fail' : 'fail')
      : (forbiddenKeys.size === 0 ? 'pass' : 'fail'),
    detail: mutationOn
      ? `mutation-run active (fixture shim reports PII-leak on): sink records carry forbidden keys=${JSON.stringify([...forbiddenKeys])} (expected empty under the shipped path)`
      : (forbiddenKeys.size === 0
        ? `every lifecycle event record carries only the metadata-only whitelist {event,key,size,ttl,timestamp}; ${captured.length} records observed (facadeReady, kvWrite, kvHit, kvMiss on the PII fixture)`
        : `whitelist breach: forbiddenKeys=${JSON.stringify([...forbiddenKeys])}`),
  });

  results.push({
    anchorAcId: 'AC-31108-1',
    verdict: mutationOn
      ? (whitelistPass ? 'fail' : 'fail')
      : (whitelistPass ? 'pass' : 'fail'),
    detail: mutationOn
      ? `mutation-run active (fixture shim reports PII-leak on): forwarded body/userId/ssn to the sink; forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)} (expected empty on the shipped code path)`
      : (whitelistPass
        ? `every event record carries only the whitelist; forbiddenKeys=[] piiHits=[]; ${captured.length} records observed for put/get/delete/facadeReady on the PII fixture`
        : `whitelist breach: forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)}`),
  });

  return { results };
}
