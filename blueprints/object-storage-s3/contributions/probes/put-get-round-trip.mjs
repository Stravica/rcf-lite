/**
 * Put/get/delete/list round-trip probe.
 *
 * Puts a 1 KiB payload with a stable content-type, gets it back, asserts
 * byte equality and content-type match. Puts three objects under a
 * prefix and lists them. Deletes the objects and asserts the delete
 * lifecycle event fires and the get returns a not-found shape.
 *
 * Anchors AC-28102-1, AC-28102-2, AC-28102-3.
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';

const AC28102_1 = 'Given a putObject through the facade for a';
const AC28102_2 = 'Given a deleteObject through the facade for a';
const AC28102_3 = 'Given at least three objects put under a';

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
  const key = probeKey('probe/put-get');
  const body = Buffer.alloc(1024, 0x41); // 1 KiB of A
  const contentType = 'application/octet-stream';
  const prefix = probeKey('probe/list-parent');
  const listKeys = [`${prefix}/a`, `${prefix}/b`, `${prefix}/c`];
  try {
    await store.ready();
    await store.putObject(key, contentType, body);
    const got = await store.getObject(key);
    const roundTripPass = got.body.length === 1024
      && got.body.equals(body)
      && got.contentType === contentType;
    const putEvent = events.find((e) => e.event === 'objectPut' && e.key === key);
    const eventPass = putEvent && putEvent.size === 1024 && putEvent.contentType === contentType;
    results.push({
      anchorAcId: 'AC-28102-1',
      verdict: roundTripPass && eventPass ? 'pass' : 'fail',
      detail: roundTripPass && eventPass
        ? `${AC28102_1} - 1 KiB round-trip byte-equal; objectPut fired with size=${putEvent.size}`
        : `${AC28102_1} - roundTripPass=${roundTripPass} eventPass=${eventPass} got.size=${got.body.length}`,
      evidence: { key, requestedContentType: contentType, gotContentType: got.contentType, gotSize: got.body.length, byteEqual: got.body.equals(body), objectPutEvent: putEvent || null },
    });

    // list under prefix
    for (const k of listKeys) await store.putObject(k, 'text/plain', Buffer.from(k));
    const listed = await store.listObjects(prefix);
    const listPass = listKeys.every((k) => listed.keys.includes(k)) && typeof listed.isTruncated === 'boolean';
    results.push({
      anchorAcId: 'AC-28102-3',
      verdict: listPass ? 'pass' : 'fail',
      detail: listPass
        ? `${AC28102_3} - list returned ${listed.keys.length} keys with isTruncated=${listed.isTruncated}`
        : `${AC28102_3} - listed=${JSON.stringify(listed)}`,
      evidence: { prefix, expectedKeys: listKeys, returnedKeys: listed.keys, isTruncated: listed.isTruncated },
    });

    // delete and confirm 404
    await store.deleteObject(key);
    let deletedEvent = events.find((e) => e.event === 'objectDeleted' && e.key === key);
    let notFound = false;
    try { await store.getObject(key); } catch (err) {
      const status = err && err.$metadata && err.$metadata.httpStatusCode;
      notFound = err.name === 'NoSuchKey' || err.Code === 'NoSuchKey' || status === 404;
    }
    results.push({
      anchorAcId: 'AC-28102-2',
      verdict: deletedEvent && notFound ? 'pass' : 'fail',
      detail: deletedEvent && notFound
        ? `${AC28102_2} - objectDeleted fired and get after delete returned NoSuchKey`
        : `${AC28102_2} - deletedEvent=${Boolean(deletedEvent)} notFound=${notFound}`,
      evidence: { key, objectDeletedEvent: deletedEvent || null, getAfterDeleteWasNotFound: notFound },
    });
    // Teardown: delete the list keys and close the facade. Every
    // teardown step is recorded on the teardown[] accumulator and any
    // failure emits its own row (authoring-standard rule 5).
  } finally {
    const teardown = [];
    for (const k of listKeys) {
      try { await store.deleteObject(k); teardown.push({ step: `deleteObject ${k}`, ok: true }); }
      catch (err) { teardown.push({ step: `deleteObject ${k}`, ok: false, error: err && err.message }); }
    }
    try { await store.close(); teardown.push({ step: 'facade close', ok: true }); }
    catch (err) { teardown.push({ step: 'facade close', ok: false, error: err && err.message }); }
    const failed = teardown.filter((t) => !t.ok);
    if (failed.length > 0) {
      results.push({
        anchorReqId: 'object-storage-s3-REQ-002',
        verdict: 'fail',
        detail: `The facade exposes named domain verbs (putObject, getObject, - teardown FAILED: ${failed.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
        evidence: { teardown },
      });
    }
  }
  return results;
}
