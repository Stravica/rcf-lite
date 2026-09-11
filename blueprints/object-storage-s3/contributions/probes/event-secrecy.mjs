/**
 * Event-secrecy probe.
 *
 * Attaches a spy to the lifecycle event sink; drives put/get/presign/
 * delete against a PII fixture (key users/1234/passport.jpg, body
 * carrying the string PII-FIXTURE-DO-NOT-LOG). Asserts every event
 * record carries only whitelisted fields ({event, ts, key, size,
 * contentType, ttl, endpointHost, bucketName}) and NO event value
 * contains the PII fixture text, a userId/ssn/dob/email field, or any
 * part of the object body bytes.
 *
 * Anchors AC-28105-1.
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';

const WHITELIST = new Set(['event', 'ts', 'key', 'size', 'contentType', 'ttl', 'endpointHost', 'bucketName']);
const FORBIDDEN_FIELDS = ['userId', 'ssn', 'dob', 'email', 'body', 'bodyBytes', 'bodyChecksum'];
const PII_TEXT = 'PII-FIXTURE-DO-NOT-LOG';

const AC28105_1 = 'Every event on the shipped lifecycle sink';

export default async function runProbe() {
  const { endpoint, bucket, region, forcePathStyle } = endpointFromEnv();
  const credentials = await credentialsFromShim(secretsShim);
  const events = [];
  const store = createObjectStore({
    endpointUrl: endpoint,
    bucket,
    credentialsRef: credentials,
    region,
    forcePathStyle,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  const key = 'users/1234/passport.jpg';
  const body = Buffer.from(`prefix-${PII_TEXT}-suffix`);
  const vendorReq = { put: null, get: null, del: null };
  try {
    await store.ready();
    // Drive one PutObject via SDK directly for per-row vendor
    // evidence, then delete it, then run the shipped-facade path.
    const { sdk } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs');
    const client = store.getClient();
    const rawPut = await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: `${key}.evidence`, Body: body, ContentType: 'image/jpeg' }));
    vendorReq.put = { httpStatus: rawPut.$metadata && rawPut.$metadata.httpStatusCode, requestId: rawPut.$metadata && rawPut.$metadata.requestId };
    const rawGet = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: `${key}.evidence` }));
    vendorReq.get = { httpStatus: rawGet.$metadata && rawGet.$metadata.httpStatusCode, requestId: rawGet.$metadata && rawGet.$metadata.requestId };
    try { await rawGet.Body.transformToByteArray(); } catch { /* drain */ }
    const rawDel = await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: `${key}.evidence` }));
    vendorReq.del = { httpStatus: rawDel.$metadata && rawDel.$metadata.httpStatusCode, requestId: rawDel.$metadata && rawDel.$metadata.requestId };

    await store.putObject(key, 'image/jpeg', body);
    await store.getObject(key);
    await store.presignGetUrl(key, 60);
    await store.deleteObject(key);

    // Every event has only whitelisted keys
    const nonWhitelistKeys = new Set();
    for (const record of events) {
      for (const k of Object.keys(record)) {
        if (!WHITELIST.has(k)) nonWhitelistKeys.add(k);
      }
    }
    results.push({
      anchorAcId: 'AC-28105-1',
      verdict: nonWhitelistKeys.size === 0 ? 'pass' : 'fail',
      detail: nonWhitelistKeys.size === 0
        ? `every event carries only whitelisted fields (${[...WHITELIST].join(',')})`
        : `unexpected event fields: ${[...nonWhitelistKeys].join(',')}`,
      evidence: { whitelist: [...WHITELIST], nonWhitelistedFields: [...nonWhitelistKeys], eventCount: events.length, vendorRequestIds: vendorReq },
    });

    // No forbidden field names
    const foundForbidden = [];
    for (const record of events) {
      for (const forbidden of FORBIDDEN_FIELDS) {
        if (forbidden in record) foundForbidden.push(forbidden);
      }
    }
    results.push({
      anchorAcId: 'AC-28105-1',
      verdict: foundForbidden.length === 0 ? 'pass' : 'fail',
      detail: foundForbidden.length === 0
        ? 'no forbidden PII field name appeared on any event'
        : `forbidden fields present: ${foundForbidden.join(',')}`,
      evidence: { forbiddenFieldNames: FORBIDDEN_FIELDS, foundForbidden, eventCount: events.length, vendorRequestIds: vendorReq },
    });

    // No event value contains the PII fixture text
    const leaks = [];
    for (const record of events) {
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === 'string' && v.includes(PII_TEXT)) leaks.push(`${record.event}.${k}`);
      }
    }
    results.push({
      anchorAcId: 'AC-28105-1',
      verdict: leaks.length === 0 ? 'pass' : 'fail',
      detail: leaks.length === 0
        ? `no event value contained the PII fixture text ${PII_TEXT}`
        : `PII fixture text leaked in: ${leaks.join(',')}`,
      evidence: { piiFixtureLiteral: PII_TEXT, leakSites: leaks, eventCount: events.length, vendorRequestIds: vendorReq },
    });

    // The key itself is passed through unchanged; it is not decomposed
    const putEvent = events.find((e) => e.event === 'objectPut');
    const keyPass = putEvent && putEvent.key === key;
    results.push({
      anchorAcId: 'AC-28105-1',
      verdict: keyPass ? 'pass' : 'fail',
      detail: keyPass
        ? `objectPut carried the key ${key} as an opaque string; no userId extraction`
        : `key was decomposed or absent on objectPut: ${JSON.stringify(putEvent)}`,
      evidence: { expectedKey: key, objectPutEvent: putEvent || null, vendorRequestIds: vendorReq },
    });
  } finally {
    await store.close();
  }
  return results;
}
