// In-memory Durable Object storage driver realising the shape the
// Cloudflare Workers DO storage API exposes on state.storage:
// `get(key)`, `put(key, value)`, `delete(key)`, `list({prefix?})`,
// `setAlarm(scheduledTime)`, `getAlarm()`, `deleteAlarm()`. Two
// backends ship, elicited per ADR-3403: `sql` and `kv`; both are
// covered in-process by the same driver factory but expose the
// backend name through `driver.backend` so the shipped code path
// can carry the trace record.
//
// The driver is dependency-free and does not talk to wrangler dev
// or to a real Durable Object; the shelf norm carries here (aligned
// with the T-1 KV in-memory driver, the T-2 in-process dispatcher
// and the messaging-queue-cloudflare in-memory driver). The
// storage-round-trip probe drives the shipped DO classes against
// this driver on both backend switches; the alarm-fires-once probe
// drives the alarm surface deterministically.

export function createInMemoryDoStorage({ backend } = {}) {
  const chosen = backend === 'kv' ? 'kv' : 'sql';
  const store = new Map();
  let alarmAt = null;

  async function get(key) {
    if (typeof key !== 'string') throw new Error('do-storage.get: key must be string');
    return store.has(key) ? store.get(key) : undefined;
  }
  async function put(key, value) {
    if (typeof key !== 'string') throw new Error('do-storage.put: key must be string');
    store.set(key, value);
  }
  async function del(key) {
    if (typeof key !== 'string') throw new Error('do-storage.delete: key must be string');
    return store.delete(key);
  }
  async function list({ prefix } = {}) {
    const out = new Map();
    for (const [k, v] of store) {
      if (!prefix || k.startsWith(prefix)) out.set(k, v);
    }
    return out;
  }
  async function setAlarm(scheduledTime) {
    if (typeof scheduledTime !== 'number') throw new Error('do-storage.setAlarm: scheduledTime must be a millis number');
    alarmAt = scheduledTime;
  }
  async function getAlarm() {
    return alarmAt;
  }
  async function deleteAlarm() {
    alarmAt = null;
  }

  return {
    backend: chosen,
    get, put, delete: del, list,
    setAlarm, getAlarm, deleteAlarm,
  };
}
