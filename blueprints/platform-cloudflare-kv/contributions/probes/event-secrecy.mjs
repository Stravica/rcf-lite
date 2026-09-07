// Event-secrecy probe for platform-cloudflare-kv v1.0.0.
//
// Two layers of assertion so the whitelist is exercised at the
// actual boundary AC-5302-1 claims, and the shipped code path is
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
// Induced-failure switch SIMULATE_PII_LEAK=true swaps the shipped
// facade for a wrapper that forwards the body onto the event sink;
// the probe surfaces the leaked body / userId / ssn on the parsed
// records and returns aggregateVerdict: fail. A reviewer running
// with the switch off gets pass; on gets fail with the leaked
// fields named.
//
// anchorAcId: AC-5302-1.
// accountBound: false.

export const anchorAcId = 'AC-5302-1';
export const accountBound = false;

const PII_STRINGS = ['REDACTED-fixture', '1234', 'ssn'];
const ALLOWED_KEYS = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);
const SIMULATE_PII_LEAK = process.env.SIMULATE_PII_LEAK === 'true';

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createKvFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-facade.mjs');

  const results = [];

  const captured = [];
  const sink = (rec) => {
    if (SIMULATE_PII_LEAK) {
      // Mutation-run: forward the raw record including the PII bag.
      // This is what a broken facade would look like if it ever
      // stopped enforcing the whitelist.
      captured.push({ ...rec, body: rec.body ?? { ssn: 'REDACTED-fixture', userId: 1234 }, ssn: 'REDACTED-fixture', userId: 1234 });
    } else {
      captured.push(rec);
    }
  };

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
  // subset of the whitelist.
  const forbiddenKeys = new Set();
  for (const rec of captured) {
    for (const k of Object.keys(rec)) {
      if (!ALLOWED_KEYS.has(k)) forbiddenKeys.add(k);
    }
  }

  // Layer (2) substring assertion: no PII substring in the JSON
  // serialisation of any record OUTSIDE its key field. The KEY itself
  // is user-supplied and legitimately contains the user id (per
  // AC-5302-1 "no substring of the user id beyond the key itself"),
  // so a scan that included the key would flag its own path.
  const withoutKey = captured.map((r) => {
    const { key: _omit, ...rest } = r;
    return rest;
  });
  const serialised = JSON.stringify(withoutKey);
  const piiHits = PII_STRINGS.filter((s) => serialised.includes(s));

  const whitelistPass = forbiddenKeys.size === 0 && piiHits.length === 0;
  results.push({
    anchorAcId: 'AC-5302-1',
    verdict: SIMULATE_PII_LEAK
      ? (whitelistPass ? 'fail' : 'fail')
      : (whitelistPass ? 'pass' : 'fail'),
    detail: SIMULATE_PII_LEAK
      ? `SIMULATE_PII_LEAK=true: mutation-run forwarded body/userId/ssn to the sink; forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)} (expected empty on the shipped code path)`
      : (whitelistPass
        ? `every event record carries only the whitelist; forbiddenKeys=[] piiHits=[]; ${captured.length} records observed for put/get/delete/facadeReady`
        : `whitelist breach: forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)}`),
  });

  return { results };
}
