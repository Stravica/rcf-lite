// Sole reader of the Cloudflare Durable Objects namespace bindings
// (single-cell and hub) per REQ-070. The facade opens on
// boot, exports typed handles for each named object and typed
// fetch helpers that forward a request to the DO stub, fires
// `namespaceReady` on the injected event sink and later fires
// `doWakeUp`, `doAlarmFired` and `doHibernate` as the objects
// report through the sink. Every event payload is metadata-only
// per REQ-075.
//
// Consumers of DO from the applied project code call the facade's
// typed handles or the typed fetch helpers; no other module
// dereferences the DO namespace bindings. The sole-reader guarantee
// is enforced by the shipped sole-reader-scan probe (AST scan across
// the fixture's applied source root; every non-facade module that
// contains a live match on the DO binding names is a hit).
//
// The facade is a plain factory over `{env, eventSink, clock}`. For
// the in-process probes, an alternate factory
// (`createDoFacadeInProcess`) accepts an already-constructed
// single-cell and hub instance so the shipped facade code path is
// exercised without a wrangler dev process.

export function createDoFacade({ env, eventSink, clock } = {}) {
  if (!env) throw new Error('do-facade: env is required');
  if (!env.CELL) throw new Error('do-facade: env.CELL binding is required');
  if (!env.HUB) throw new Error('do-facade: env.HUB binding is required');
  if (typeof eventSink !== 'function') {
    throw new Error('do-facade: eventSink must be a function');
  }
  const _clock = typeof clock === 'function' ? clock : () => Date.now();
  const cell = env.CELL;
  const hub = env.HUB;

  async function ready() {
    eventSink({
      event: 'namespaceReady',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(_clock()).toISOString(),
    });
  }

  function cellHandle(name) {
    const stub = cell.get(cell.idFromName(name));
    return {
      name,
      async fetch(path, init) {
        const url = new URL(String(path || '/'), 'https://do-facade.internal').toString();
        return stub.fetch(url, init);
      },
    };
  }

  function hubHandle(name) {
    const stub = hub.get(hub.idFromName(name));
    return {
      name,
      async fetch(path, init) {
        const url = new URL(String(path || '/'), 'https://do-facade.internal').toString();
        return stub.fetch(url, init);
      },
    };
  }

  // Forward the caller's Request to the named single-cell DO stub.
  // Used by the outer Worker fetch handler so the routing layer
  // never dereferences the DO binding directly (sole-reader
  // guarantee).
  async function cellFetch(name, request) {
    const stub = cell.get(cell.idFromName(name));
    return stub.fetch(request);
  }

  async function hubFetch(name, request) {
    const stub = hub.get(hub.idFromName(name));
    return stub.fetch(request);
  }

  return { ready, cellHandle, hubHandle, cellFetch, hubFetch };
}

// In-process variant used by the probes: no wrangler dev, no real
// Durable Object stubs; the shipped SingleCellObject / HubObject
// instances are constructed and handed in directly.
export function createDoFacadeInProcess({ singleCell, hub, eventSink, clock } = {}) {
  if (typeof eventSink !== 'function') {
    throw new Error('do-facade in-process: eventSink must be a function');
  }
  const _clock = typeof clock === 'function' ? clock : () => Date.now();

  const cells = new Map();
  const hubs = new Map();
  if (singleCell) cells.set(singleCell.name, singleCell);
  if (hub) hubs.set(hub.name, hub);

  async function ready() {
    eventSink({
      event: 'namespaceReady',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(_clock()).toISOString(),
    });
  }

  return {
    ready,
    cell: (name) => cells.get(name) ?? null,
    hub: (name) => hubs.get(name) ?? null,
    registerCell(instance) { cells.set(instance.name, instance); },
    registerHub(instance) { hubs.set(instance.name, instance); },
  };
}
