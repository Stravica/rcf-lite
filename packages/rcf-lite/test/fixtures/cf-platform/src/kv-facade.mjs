// Sole reader of the Cloudflare Workers KV binding (env.CACHE on
// the cf-platform fixture; the elicited binding name in a real
// applied project) per REQ-001. The
// facade wraps the KV binding shape with typed domain verbs (get,
// getWithMetadata, put, delete, list) and emits lifecycle events
// (facadeReady, kvHit, kvMiss, kvWrite) whose payload is
// metadata-only per REQ-004: {key, size, ttl, timestamp}. No body
// bytes and no PII leaves the facade via the event sink.
//
// The event sink is injected. In the local probes it is a spy that
// accumulates records; in a real project it is wired to the applied
// logging companion.
//
// Every consumer of KV calls the facade's typed verbs; no other
// module dereferences env.<binding>. Enforced by the applied fixture
// tree (a grep in the guide's checklist) and by review at self-review.

export function createKvFacade({ binding, eventSink, keyPrefix, defaultCacheTtl }) {
  if (!binding) throw new Error('kv-facade: binding is required');
  if (typeof eventSink !== 'function') {
    throw new Error('kv-facade: eventSink must be a function');
  }
  const prefix = keyPrefix ?? '';
  const defaultTtl = typeof defaultCacheTtl === 'number' ? defaultCacheTtl : null;

  function fullKey(key) {
    return prefix + key;
  }

  function emit(event, key, ttl, size) {
    eventSink({
      event,
      key: fullKey(key),
      size: size ?? 0,
      ttl: ttl ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  async function ready() {
    // A trivial probe against the binding: list with limit 1 confirms
    // the binding is bound. The real KV binding accepts list against
    // any bound namespace; the in-memory driver realises the same
    // shape.
    await binding.list({ limit: 1 });
    eventSink({
      event: 'facadeReady',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    ready,
    async get(key) {
      const record = await binding.getWithMetadata(fullKey(key));
      if (record.value === null) {
        emit('kvMiss', key, null, 0);
        return null;
      }
      emit('kvHit', key, null, record.value.length ?? 0);
      return record.value;
    },
    async getWithMetadata(key) {
      const record = await binding.getWithMetadata(fullKey(key));
      if (record.value === null) {
        emit('kvMiss', key, null, 0);
        return { value: null, metadata: null };
      }
      emit('kvHit', key, null, record.value.length ?? 0);
      return record;
    },
    async put(key, value, options = {}) {
      const ttl = typeof options.ttl === 'number' ? options.ttl : defaultTtl;
      const bindingOptions = {};
      if (typeof ttl === 'number') bindingOptions.expirationTtl = ttl;
      if (options.metadata !== undefined) bindingOptions.metadata = options.metadata;
      await binding.put(fullKey(key), value, bindingOptions);
      const size = typeof value === 'string' ? value.length : JSON.stringify(value).length;
      emit('kvWrite', key, ttl, size);
    },
    async delete(key) {
      await binding.delete(fullKey(key));
      emit('kvWrite', key, 0, 0);
    },
    async list(options = {}) {
      const prefixArg = options.prefix ? fullKey(options.prefix) : prefix || undefined;
      const result = await binding.list({ ...options, prefix: prefixArg });
      const strippedKeys = result.keys.map((k) => ({
        name: prefix && k.name.startsWith(prefix) ? k.name.slice(prefix.length) : k.name,
        metadata: k.metadata ?? null,
      }));
      return { keys: strippedKeys, listComplete: result.list_complete ?? true, cursor: result.cursor };
    },
  };
}
