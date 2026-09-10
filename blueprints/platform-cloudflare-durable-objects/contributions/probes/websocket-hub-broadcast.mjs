// Websocket-hub-broadcast probe for platform-cloudflare-durable-objects v1.0.0.
//
// Wires a HubObject to an in-process state stub, accepts two
// in-process paired sockets (createInProcessSocketPair), drives a
// broadcast from client A and asserts B receives within the
// elicited window (default 500ms). Then drives hibernate-and-wake
// round-trip: hibernate, wake once (doWakeUp emitted,
// lastBroadcast returned), wake again (no second doWakeUp).
// Finally scans every emitted record on the sink against the
// allowed key set {event, key, size, ttl, timestamp, objectName,
// scheduledTime} and asserts zero forbidden-key hits (AC-33106-1).
//
// Two mutation switches are triggered fixture-side by the
// shim h2-cf-do-websocket-hub-shim.mjs: a PII-leak wrapper on the
// sink adapter that injects forbidden fields on every emitted
// record, and a broadcast-hang gate that pauses the probe past
// the elicited window before it fires the broadcast. Under either
// mutation the corresponding result trips fail.
//
// anchorAcId: AC-33105-1.
// Additional-result anchors: AC-33110-1 (hibernate-and-wake round
// trip), AC-33106-1 (event-secrecy over every emitted record).
// accountBound: false.

export const anchorAcId = 'AC-33105-1';
export const accountBound = false;

const ALLOWED_KEYS = new Set(['event', 'key', 'size', 'ttl', 'timestamp', 'objectName', 'scheduledTime']);
const FORBIDDEN_KEYS = ['body', 'ssn', 'userId', 'headers', 'cookies', 'request', 'payload'];

export default async function runProbe() {
  const { createInMemoryDoStorage } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-storage.mjs');
  const { HubObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-hub.mjs');
  const { createInProcessDoState, createInProcessSocketPair } = await import('./probe-utils.mjs');
  const { prepareHubBroadcastSeams } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-do-websocket-hub-shim.mjs');

  const seams = prepareHubBroadcastSeams();
  const events = [];
  const baseSink = (rec) => events.push(rec);
  const eventSink = seams.wrapSink(baseSink);
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const state = createInProcessDoState();
  const hub = new HubObject({ state, storage, eventSink, name: 'lobby', hibernateAfterIdleMs: 500 });

  const sockA = createInProcessSocketPair('A');
  const sockB = createInProcessSocketPair('B');
  await hub.accept(sockA);
  await hub.accept(sockB);

  const results = [];

  // AC-33105-1: broadcast from A reaches both A and B within 500ms.
  const started = Date.now();
  const payload = 'ping';
  if (seams.hangBeforeBroadcastMs > 0) {
    await new Promise((r) => setTimeout(r, seams.hangBeforeBroadcastMs));
  }
  await hub.webSocketMessage(sockA, JSON.stringify({ type: 'broadcast', payload }));
  const elapsed = Date.now() - started;
  const gotA = sockA.inbound.find((s) => s.includes('"payload":"ping"'));
  const gotB = sockB.inbound.find((s) => s.includes('"payload":"ping"'));
  const persisted = await storage.get('lastBroadcast');
  const broadcastOk = !!gotA && !!gotB && elapsed <= 500 && !!persisted && persisted.includes('"payload":"ping"');
  results.push({
    anchorAcId: 'AC-33105-1',
    verdict: broadcastOk ? 'pass' : 'fail',
    detail: broadcastOk
      ? `broadcast fan-out (mutation-switches off): A received ${gotA} B received ${gotB}; elapsed ${elapsed}ms within 500ms window; storage.lastBroadcast persisted`
      : `broadcast fault${seams.hangOn ? ' (mutation-run active: fixture shim reports broadcast-hang on)' : ''}: gotA=${!!gotA} gotB=${!!gotB} elapsed=${elapsed}ms persisted=${!!persisted}`,
  });

  // AC-33110-1: hibernate-and-wake round-trip preserves storage and doWakeUp fires exactly once.
  const preWakeCount = events.length;
  await hub.hibernate();
  const wake1 = await hub.wake();
  const wake2 = await hub.wake();
  const wakeEvents = events.slice(preWakeCount).filter((e) => e.event === 'doWakeUp');
  const hibernateOk =
    wake1.lastBroadcast === persisted &&
    wake2.alreadyAwake === true &&
    wake2.lastBroadcast === persisted &&
    wakeEvents.length === 1;
  results.push({
    anchorAcId: 'AC-33110-1',
    verdict: hibernateOk ? 'pass' : 'fail',
    detail: hibernateOk
      ? `hibernate-and-wake round-trip: doWakeUp fired once; wake1.lastBroadcast preserved; wake2.alreadyAwake=true with same lastBroadcast`
      : `hibernate-wake fault: wakeEventCount=${wakeEvents.length} wake1=${JSON.stringify(wake1)} wake2=${JSON.stringify(wake2)}`,
  });

  // AC-33106-1: every event carries only allowed keys; no forbidden keys.
  const forbiddenHits = [];
  const extraKeyHits = [];
  for (const rec of events) {
    const extras = Object.keys(rec).filter((k) => !ALLOWED_KEYS.has(k));
    if (extras.length) extraKeyHits.push({ event: rec.event, extras });
    for (const k of FORBIDDEN_KEYS) if (k in rec) forbiddenHits.push({ event: rec.event, forbiddenKey: k });
  }
  const secrecyOk = forbiddenHits.length === 0 && extraKeyHits.length === 0;
  results.push({
    anchorAcId: 'AC-33106-1',
    verdict: secrecyOk ? 'pass' : 'fail',
    detail: secrecyOk
      ? `event-secrecy scan across ${events.length} records: allowed-key set {${[...ALLOWED_KEYS].join(', ')}}; forbidden-key hits 0; extra-key hits 0`
      : `event-secrecy fault${seams.leakOn ? ' (mutation-run active: fixture shim reports PII-leak on)' : ''}: forbiddenHits=${JSON.stringify(forbiddenHits.slice(0, 5))} extraKeyHits=${JSON.stringify(extraKeyHits.slice(0, 5))}`,
  });

  return { results };
}
