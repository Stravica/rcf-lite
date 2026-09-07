// Probe: drift-audit event secrecy.
//
// anchorAcId: AC-36107-1. accountBound: false.
//
// Drives the shipped drift-audit runner realisation
// (packages/rcf-lite/test/fixtures/cf-edge/src/drift-audit-runner.mjs)
// with a synthetic manifest loader and a fake fetch that returns a
// live-zone response with one mismatched rule. Asserts every record
// on the sink carries only {ruleId, clientIpHash, outcome, timestamp,
// diff} keys and NO full IPv4 or IPv6 address, NO body key, NO user
// agent key. Under SIMULATE_EVENT_LEAK_IP=true the runner injects a
// full client IP into the outcome so the probe surfaces the leak.

import { FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-36107-1';
export const accountBound = false;

const IPV4 = /\b(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}\b/;
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/;
const ALLOWED_KEYS = new Set(['ruleId', 'clientIpHash', 'outcome', 'timestamp', 'diff']);
const FORBIDDEN_KEYS = new Set(['body', 'userAgent', 'user-agent', 'clientIp', 'ip', 'sourceIp']);

function containsIp(text) {
  if (typeof text !== 'string') return null;
  const v4 = text.match(IPV4);
  if (v4) return v4[0];
  const v6 = text.match(IPV6);
  if (v6) return v6[0];
  return null;
}

export default async function runProbe() {
  const runnerMod = await import(`${FIXTURE_DIR}/src/drift-audit-runner.mjs`);
  const manifestRule = {
    id: 'public-api-per-ip',
    expression: '(http.request.uri.path matches "^/api/")',
    threshold: 60,
    period: 60,
    characteristics: ['ip.src', 'cf.colo.id'],
    action: 'block',
    duration: 60,
  };
  const liveRule = { ...manifestRule, threshold: 90 };
  const captured = [];
  const eventSink = (record) => captured.push(record);
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { result: [liveRule] }; },
  });
  const runner = runnerMod.createDriftAuditRunner({
    env: {
      CF_ZONE_ID: 'fixture-zone-id',
      SIMULATE_EVENT_LEAK_IP: process.env.SIMULATE_EVENT_LEAK_IP,
    },
    eventSink,
    fetch: fakeFetch,
    clock: () => '2026-09-07T22:00:00.000Z',
    cadence: 'daily',
    manifestLoader: async () => [manifestRule],
  });
  const report = await runner.runOnce();
  const results = [];
  if (captured.length === 0) {
    results.push({ anchorAcId: 'AC-36107-1', verdict: 'fail', detail: 'drift-audit runner produced zero records; expected one for the threshold drift.' });
    return { results };
  }
  let ipLeak = null;
  let keyLeak = null;
  for (const rec of captured) {
    for (const k of Object.keys(rec)) {
      if (FORBIDDEN_KEYS.has(k)) keyLeak = k;
      if (!ALLOWED_KEYS.has(k)) keyLeak = keyLeak || `unexpected-key:${k}`;
    }
    for (const v of Object.values(rec)) {
      if (typeof v === 'string') {
        const hit = containsIp(v);
        if (hit) ipLeak = hit;
      }
    }
  }
  if (keyLeak) {
    results.push({ anchorAcId: 'AC-36107-1', verdict: 'fail', detail: `drift-audit record carries a forbidden or unexpected key: ${keyLeak}` });
  }
  if (ipLeak) {
    results.push({ anchorAcId: 'AC-36107-1', verdict: 'fail', detail: `drift-audit record leaked a full IP address in a string field: ${ipLeak}` });
  }
  if (results.length === 0) {
    results.push({
      anchorAcId: 'AC-36107-1',
      verdict: 'pass',
      detail: `drift-audit runner produced ${captured.length} record(s); every record carries only ${[...ALLOWED_KEYS].join(', ')} and no full IP, body or user-agent field appears.`,
    });
  }
  return {
    results,
    extra: {
      recordCount: captured.length,
      driftCount: report.driftCount,
      allowedKeys: [...ALLOWED_KEYS],
    },
  };
}
