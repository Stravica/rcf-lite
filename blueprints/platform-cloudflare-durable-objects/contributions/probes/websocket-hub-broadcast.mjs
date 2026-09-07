// Websocket-hub-broadcast probe for platform-cloudflare-durable-objects v1.0.0.
//
// Wires a HubObject to a fake state, accepts two fake sockets
// (createFakeSocketPair), drives a broadcast from client A and
// asserts B receives within the elicited window (default 500ms).
// Then drives hibernate-and-wake round-trip: hibernate, wake once
// (doWakeUp emitted, lastBroadcast returned), wake again (no
// second doWakeUp). Finally scans every emitted record on the sink
// against the allowed key set {event, key, size, ttl, timestamp,
// objectName, scheduledTime} and asserts zero forbidden-key hits
// (AC-33106-1); under SIMULATE_PII_LEAK=true a wrapped sink forwards
// a synthetic body-bearing record and the probe surfaces it,
// returning fail on the secrecy result.
//
// Under SIMULATE_HUB_HANG=true the broadcast handler is wrapped
// with an artificial delay past the elicited window; the probe
// surfaces the hang and returns fail on the broadcast-within-
// window check.
//
// anchorAcId: AC-33105-1 (primary; AC-33110-1 and AC-33106-1
// covered as additional results).
// accountBound: false.

export const anchorAcId = 'AC-33105-1';
export const accountBound = false;

const ALLOWED_KEYS = new Set(['event', 'key', 'size', 'ttl', 'timestamp', 'objectName', 'scheduledTime']);
const FORBIDDEN_KEYS = ['body', 'ssn', 'userId', 'headers', 'cookies', 'request', 'payload'];

export default async function runProbe() {
  const { createInMemoryDoStorage } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-storage.mjs');
  const { HubObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-hub.mjs');
  const { createFakeState, createFakeSocketPair } = await import('./probe-utils.mjs');

  const events = [];
  const cleanSink = (rec) => events.push(rec);
  const leakySink = (rec) => events.push({
    ...rec,
    body: 'Hello, world (leaked test body)',
    ssn: '123-45-6789',
    userId: 'user_leaked_test_uid',
  });
  const eventSink = process.env.SIMULATE_PII_LEAK === 'true' ? leakySink : cleanSink;
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const state = createFakeState();
  const hub = new HubObject({ state, storage, eventSink, name: 'lobby', hibernateAfterIdleMs: 500 });

  const sockA = createFakeSocketPair('A');
  const sockB = createFakeSocketPair('B');
  await hub.accept(sockA);
  await hub.accept(sockB);

  const results = [];

  // AC-33105-1: broadcast from A reaches both A and B within 500ms.
  const started = Date.now();
  const payload = 'ping';
  if (process.env.SIMULATE_HUB_HANG === 'true') {
    await new Promise((r) => setTimeout(r, 750));
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
      ? `broadcast fan-out: A received ${gotA} B received ${gotB}; elapsed ${elapsed}ms within 500ms window; storage.lastBroadcast persisted`
      : `broadcast fault: gotA=${!!gotA} gotB=${!!gotB} elapsed=${elapsed}ms persisted=${!!persisted}`,
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
      : `event-secrecy fault: forbiddenHits=${JSON.stringify(forbiddenHits.slice(0, 5))} extraKeyHits=${JSON.stringify(extraKeyHits.slice(0, 5))}`,
  });

  return { results };
}
