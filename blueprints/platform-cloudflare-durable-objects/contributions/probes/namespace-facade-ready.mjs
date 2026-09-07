// Namespace-facade-ready probe for platform-cloudflare-durable-objects v1.0.0.
//
// Opens the DO facade against an in-process pair of DO instances
// (a SingleCellObject wired to the in-memory storage driver and a
// HubObject wired to a fake state), calls ready(), asserts
// namespaceReady fires on the injected sink with a metadata-only
// payload {event, key, size, ttl, timestamp} and asserts the
// facade exposes cell(name) and hub(name) handles that return the
// registered instances.
//
// anchorAcId: AC-33101-1.
// accountBound: false.

export const anchorAcId = 'AC-33101-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryDoStorage } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-storage.mjs');
  const { SingleCellObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-single-cell.mjs');
  const { HubObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-hub.mjs');
  const { createDoFacadeInProcess } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-facade.mjs');
  const { createFakeState } = await import('./probe-utils.mjs');

  const events = [];
  const eventSink = (rec) => events.push(rec);

  const cellStorage = createInMemoryDoStorage({ backend: 'sql' });
  const hubStorage = createInMemoryDoStorage({ backend: 'sql' });
  const singleCell = new SingleCellObject({ storage: cellStorage, eventSink, name: 'main' });
  const hub = new HubObject({ state: createFakeState(), storage: hubStorage, eventSink, name: 'lobby' });
  const facade = createDoFacadeInProcess({ singleCell, hub, eventSink });

  const results = [];

  await facade.ready();
  const ready = events.filter((e) => e.event === 'namespaceReady');
  const allowed = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);
  const extra = ready[0] ? Object.keys(ready[0]).filter((k) => !allowed.has(k)) : ['(no record)'];
  const readyOk = ready.length === 1 && ready[0].key === null && ready[0].size === 0 && ready[0].ttl === null && extra.length === 0;
  results.push({
    anchorAcId: 'AC-33101-1',
    verdict: readyOk ? 'pass' : 'fail',
    detail: readyOk
      ? `namespaceReady fired once; payload keys drawn from allowed set {event,key,size,ttl,timestamp}; key=null size=0 ttl=null timestamp=${ready[0].timestamp}`
      : `namespaceReady expected once with allowed keys only; observed count=${ready.length} extraKeys=${JSON.stringify(extra)} record=${JSON.stringify(ready[0] ?? null)}`,
  });

  const cellBack = facade.cell('main');
  const hubBack = facade.hub('lobby');
  const handlesOk = cellBack === singleCell && hubBack === hub;
  results.push({
    anchorAcId: 'AC-33101-1',
    verdict: handlesOk ? 'pass' : 'fail',
    detail: handlesOk
      ? `facade.cell("main") returned the registered SingleCellObject and facade.hub("lobby") returned the registered HubObject`
      : `facade handle lookup mismatch: cell=${cellBack ? 'present' : 'null'} hub=${hubBack ? 'present' : 'null'}`,
  });

  return { results };
}
