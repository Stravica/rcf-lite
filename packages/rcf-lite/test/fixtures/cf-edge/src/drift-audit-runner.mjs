// Rate-limit drift-audit runner. Realises TAC-3703 in the shipped
// fixture. The applying project copies the shape from the blueprint
// guide; this file is the fixture realisation the probes drive.
//
// Runtime contract per REQ-004 and AC-36104-1:
//
// - Factory createDriftAuditRunner({env, eventSink, fetch, clock, cadence, manifestLoader})
//   returns {runOnce, schedule, stop}.
// - runOnce() fetches the live rules from the Cloudflare API for the
//   elicited zone id and diffs field-by-field against the manifest
//   loaded via manifestLoader.
// - Per mismatched rule, constructs one drift record with the
//   metadata-only shape {ruleId, outcome, timestamp, diff} and calls
//   eventSink(record). The record is Object.frozen at the boundary so
//   downstream handlers cannot enrich it with a leaked field
//   (AC-36107-1).
// - When cadence is 'off' the runner refuses to schedule (returns a
//   noop schedule) and runOnce still returns an empty report; the
//   applying project should not wire the runner in that case.
//
// The runner accepts a synthetic manifestLoader and a fake fetch so
// probes and the anatomy test drive it in-process without a live
// Cloudflare API call. Under SIMULATE_EVENT_LEAK_IP=true the runner
// injects a full client IP into every drift record's outcome field so
// event-secrecy.mjs surfaces the leak.

export const RATE_LIMIT_RULE_FIELDS = Object.freeze([
  'id',
  'expression',
  'threshold',
  'period',
  'characteristics',
  'action',
  'duration',
]);

export function diffRulePair(manifestRule, liveRule) {
  const changes = [];
  for (const field of RATE_LIMIT_RULE_FIELDS) {
    if (field === 'id') continue;
    const mv = manifestRule[field];
    const lv = liveRule[field];
    if (Array.isArray(mv) || Array.isArray(lv)) {
      if (JSON.stringify(mv) !== JSON.stringify(lv)) {
        changes.push({ field, manifestValue: mv, liveValue: lv });
      }
      continue;
    }
    if (mv !== lv) changes.push({ field, manifestValue: mv, liveValue: lv });
  }
  return changes;
}

function freezeRecord(record) {
  // Freeze arrays too so a downstream handler cannot .push into a diff.
  if (Array.isArray(record.diff)) {
    record.diff.forEach((d) => Object.freeze(d));
    Object.freeze(record.diff);
  }
  return Object.freeze(record);
}

export function createDriftAuditRunner({
  env = {},
  eventSink = () => {},
  fetch: fetchImpl = globalThis.fetch,
  clock = () => new Date().toISOString(),
  cadence = 'daily',
  manifestLoader,
}) {
  if (typeof manifestLoader !== 'function') {
    throw new Error('createDriftAuditRunner: manifestLoader function required');
  }
  const leak = env.SIMULATE_EVENT_LEAK_IP === 'true';
  const zoneId = env.CF_ZONE_ID || '';

  async function runOnce() {
    if (cadence === 'off') {
      return { ranAt: clock(), driftCount: 0, records: [], skipped: 'cadence-off' };
    }
    const manifestRules = await manifestLoader();
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets`;
    const res = await fetchImpl(url, { headers: env.CF_API_TOKEN ? { authorization: `Bearer ${env.CF_API_TOKEN}` } : {} });
    if (!res.ok) throw new Error(`drift-audit fetch failed: ${res.status}`);
    const body = await res.json();
    const liveById = new Map();
    for (const r of body.result || []) liveById.set(r.id, r);
    const records = [];
    for (const rule of manifestRules) {
      const live = liveById.get(rule.id);
      if (!live) {
        const record = {
          ruleId: rule.id,
          clientIpHash: null,
          outcome: leak ? `driftDetected clientIp=203.0.113.7` : 'driftDetected',
          timestamp: clock(),
          diff: [{ field: '__missing__', manifestValue: 'present', liveValue: 'absent' }],
        };
        records.push(freezeRecord(record));
        eventSink(freezeRecord({ ...record }));
        continue;
      }
      const changes = diffRulePair(rule, live);
      if (changes.length === 0) continue;
      const record = {
        ruleId: rule.id,
        clientIpHash: null,
        outcome: leak ? `driftDetected clientIp=203.0.113.7` : 'driftDetected',
        timestamp: clock(),
        diff: changes,
      };
      records.push(freezeRecord(record));
      eventSink(freezeRecord({ ...record }));
    }
    return { ranAt: clock(), driftCount: records.length, records };
  }

  function schedule() {
    if (cadence === 'off') return { stop: () => {}, cadence };
    return { stop: () => {}, cadence };
  }

  return {
    runOnce,
    schedule,
    stop: () => {},
  };
}
