// Facade round-trip probe for platform-cloudflare-kv v1.0.0.
//
// Opens the KV facade against the cf-platform fixture's in-memory
// KV driver, drives put-and-get on a fixture key, asserts the
// facadeReady event fires on the injected sink, asserts the
// round-trip returns the same value bytes, asserts kvWrite / kvHit
// events fire on the paired operations, then deletes the key and
// asserts kvMiss fires on a subsequent read.
//
// Also covers AC-31104-1 by extending the same run with a list-
// with-prefix pass over 10 keys under flags/ so the round-trip
// probe carries the compact case for the list mechanism.
//
// AC-31102-1 (env.CACHE dereferenced in exactly one fixture source
// file) is carried here as a runtime observable: the probe reads
// the fixture src/ tree at run time and asserts exactly one file
// (src/kv-facade.mjs) contains the env.CACHE substring. This gives
// the sole-reader-grep AC a runtime observable in a probe result
// alongside the anatomy-test assertion (dispatch addendum, first
// dispatch groundwork note 2).
//
// anchorAcId: AC-31103-1 (primary: put/get round-trip and paired
//   events per US-31103). Additional results cover AC-31101-1
//   (facadeReady on boot), AC-31103-2 (delete then kvMiss),
//   AC-31104-1 (list-with-prefix compact case) and AC-31102-1
//   (sole-reader-grep runtime observable).
// accountBound: false.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform', 'src');

export const anchorAcId = 'AC-31103-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createKvFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-facade.mjs');

  const events = [];
  const eventSink = (rec) => events.push(rec);
  const binding = createInMemoryKv();
  const facade = createKvFacade({ binding, eventSink });

  const results = [];

  // AC-31101-1 seam: ready() fires facadeReady with metadata-only
  // payload. Not the primary anchor here, but the signal is worth
  // surfacing on this probe as an additional result.
  await facade.ready();
  const ready = events.filter((e) => e.event === 'facadeReady');
  results.push({
    anchorAcId: 'AC-31101-1',
    verdict: ready.length === 1 && ready[0].key === null && ready[0].size === 0 ? 'pass' : 'fail',
    detail: ready.length === 1
      ? `facadeReady fired once with key=${ready[0].key} size=${ready[0].size} ttl=${ready[0].ttl} timestamp=${ready[0].timestamp}`
      : `facadeReady expected once, observed ${ready.length}`,
  });

  // AC-31103-1: put/get round-trip returns same bytes and pairs
  // paired kvWrite / kvHit events.
  const key = 'kv-facade-round-trip/hello';
  const value = 'hello workers-kv';
  await facade.put(key, value, { metadata: { v: 1 } });
  const got = await facade.get(key);
  const writeEvents = events.filter((e) => e.event === 'kvWrite');
  const hitEvents = events.filter((e) => e.event === 'kvHit');
  const roundTripPass = got === value && writeEvents.length === 1 && hitEvents.length === 1;
  results.push({
    anchorAcId: 'AC-31103-1',
    verdict: roundTripPass ? 'pass' : 'fail',
    detail: roundTripPass
      ? `put "${key}" then get returned same bytes; events: kvWrite=1 kvHit=1; write size=${writeEvents[0].size}`
      : `put/get mismatch: got=${JSON.stringify(got)} kvWrite=${writeEvents.length} kvHit=${hitEvents.length}`,
  });

  // AC-31103-2: delete then get returns null and emits kvMiss.
  await facade.delete(key);
  const afterDelete = await facade.get(key);
  const missEvents = events.filter((e) => e.event === 'kvMiss');
  const deletePass = afterDelete === null && missEvents.length >= 1;
  results.push({
    anchorAcId: 'AC-31103-2',
    verdict: deletePass ? 'pass' : 'fail',
    detail: deletePass
      ? `delete then get returned null; kvMiss events observed=${missEvents.length}`
      : `delete branch fault: afterDelete=${JSON.stringify(afterDelete)} kvMiss=${missEvents.length}`,
  });

  // AC-31104-1: list with prefix returns all 10 keys with metadata
  // shape. Extended compact case on this probe; list-with-prefix
  // probe holds the primary anchor.
  const listBinding = createInMemoryKv();
  const listEvents = [];
  const listFacade = createKvFacade({ binding: listBinding, eventSink: (rec) => listEvents.push(rec) });
  for (let i = 0; i < 10; i += 1) {
    await listFacade.put(`flags/feature-${i}`, `on-${i}`, { metadata: { v: 1, i } });
  }
  const listed = await listFacade.list({ prefix: 'flags/' });
  const listOk = listed.keys.length === 10 && listed.keys.every((k) => typeof k.name === 'string' && k.name.startsWith('flags/') && k.metadata && typeof k.metadata === 'object');
  results.push({
    anchorAcId: 'AC-31104-1',
    verdict: listOk ? 'pass' : 'fail',
    detail: listOk
      ? `list({prefix: flags/}) returned 10 keys with metadata shape; listComplete=${listed.listComplete}`
      : `list-with-prefix fault: keyCount=${listed.keys.length} sample=${JSON.stringify(listed.keys[0])}`,
  });

  // AC-31102-1 runtime observable: grep the fixture src/ tree for
  // env.CACHE. The dereference must appear in exactly one file
  // (src/kv-facade.mjs); the raw KV binding must not leak into any
  // other module (or the future adapter swap would need to move
  // multiple call sites).
  const entries = await readdir(FIXTURE_SRC);
  const hits = [];
  for (const name of entries) {
    if (!name.endsWith('.mjs')) continue;
    const text = await readFile(resolve(FIXTURE_SRC, name), 'utf8');
    if (text.includes('env.CACHE')) hits.push(name);
  }
  const soleReaderPass = hits.length === 1 && hits[0] === 'kv-facade.mjs';
  results.push({
    anchorAcId: 'AC-31102-1',
    verdict: soleReaderPass ? 'pass' : 'fail',
    detail: soleReaderPass
      ? `env.CACHE dereferenced in exactly one fixture src/ module: ${hits[0]}`
      : `sole-reader-grep fault: expected exactly kv-facade.mjs to dereference env.CACHE; observed ${JSON.stringify(hits)}`,
  });

  return { results };
}
