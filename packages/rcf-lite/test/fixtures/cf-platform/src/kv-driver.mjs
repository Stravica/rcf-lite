// In-memory KV driver realising the Cloudflare Workers KV binding
// shape a Worker receives on env.<binding> (get, put, delete, list,
// getWithMetadata). The T-1 probes drive this driver on the local
// probes; the same facade module also drives a real KV namespace via
// the Workers KV REST shape when the real-account smoke probe runs.
//
// The driver is intentionally lightweight: an in-memory Map with a
// per-entry expiration clock. Values are stored as strings (the
// wire-format the Workers KV binding accepts on put and returns on
// get). Metadata is a JSON-serialisable object per the Cloudflare
// binding contract.

export function createInMemoryKv({ clock } = {}) {
  const now = clock ?? (() => Date.now());
  const entries = new Map();

  function isExpired(entry) {
    return typeof entry.expiresAt === 'number' && entry.expiresAt <= now();
  }

  return {
    async get(key, options) {
      const entry = entries.get(key);
      if (!entry || isExpired(entry)) {
        if (entry) entries.delete(key);
        return null;
      }
      const type = typeof options === 'string' ? options : options?.type;
      if (type === 'json') return JSON.parse(entry.value);
      return entry.value;
    },
    async getWithMetadata(key, options) {
      const entry = entries.get(key);
      if (!entry || isExpired(entry)) {
        if (entry) entries.delete(key);
        return { value: null, metadata: null };
      }
      const type = typeof options === 'string' ? options : options?.type;
      const value = type === 'json' ? JSON.parse(entry.value) : entry.value;
      return { value, metadata: entry.metadata ?? null };
    },
    async put(key, value, options) {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const expiresAt =
        typeof options?.expirationTtl === 'number'
          ? now() + options.expirationTtl * 1000
          : typeof options?.expiration === 'number'
          ? options.expiration * 1000
          : null;
      entries.set(key, {
        value: stringValue,
        metadata: options?.metadata ?? null,
        expiresAt,
      });
    },
    async delete(key) {
      entries.delete(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? '';
      const limit = typeof options?.limit === 'number' ? options.limit : 1000;
      const keys = [];
      for (const [name, entry] of entries.entries()) {
        if (isExpired(entry)) continue;
        if (!name.startsWith(prefix)) continue;
        keys.push({ name, metadata: entry.metadata ?? null });
        if (keys.length >= limit) break;
      }
      return { keys, list_complete: true, cursor: undefined };
    },
    // Testing helpers (not part of the Workers KV binding shape); used
    // only by the probes to seed and inspect the driver.
    __size() {
      return entries.size;
    },
  };
}
