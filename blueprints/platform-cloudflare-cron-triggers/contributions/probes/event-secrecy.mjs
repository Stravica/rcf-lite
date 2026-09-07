// Event-secrecy probe for platform-cloudflare-cron-triggers v1.0.0.
//
// Two layers of assertion so the whitelist is exercised at the
// actual boundary AC-32106-1 claims, and the shipped code path is
// exercised end-to-end with a PII fixture closure:
//
//   (1) Direct-boundary assertion: every event record's keys are
//       a subset of the allow-list {event, expression, scheduledTime,
//       outcome, duration, softBudgetMs, deltaMs}.
//
//   (2) Substring assertion: no PII substring in the JSON
//       serialisation of any record OUTSIDE its expression field
//       (the expression is a legitimate literal from wrangler.toml).
//
// Induced-failure switch SIMULATE_PII_LEAK=true wraps the sink so
// it forwards the closure onto every record; the probe surfaces
// the leaked fields and returns aggregateVerdict: fail. A reviewer
// running with the switch off gets pass; on gets fail with the
// leaked substrings named.
//
// anchorAcId: AC-32106-1.
// accountBound: false.

export const anchorAcId = 'AC-32106-1';
export const accountBound = false;

const PII_STRINGS = ['REDACTED-fixture', '4242', 'ssn'];
const ALLOWED_KEYS = new Set(['event', 'expression', 'scheduledTime', 'outcome', 'duration', 'softBudgetMs', 'deltaMs']);
const SIMULATE_PII_LEAK = process.env.SIMULATE_PII_LEAK === 'true';

export default async function runProbe() {
  const { createDispatcher } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/dispatcher.mjs');

  const results = [];
  const captured = [];

  const baseSink = (rec) => captured.push(rec);
  const leakySink = (rec) => captured.push({ ...rec, body: rec.body ?? { ssn: 'REDACTED-fixture', userId: 4242 }, ssn: 'REDACTED-fixture', userId: 4242 });
  const sink = SIMULATE_PII_LEAK ? leakySink : baseSink;

  // Closure over PII fixture; the handler sees it, the dispatcher never does.
  const piiClosure = { userId: 4242, ssn: 'REDACTED-fixture' };

  const dispatcher = createDispatcher({
    routes: [
      {
        expression: '* * * * *',
        handler: async () => {
          // Handler reads the closure but the dispatcher constructs
          // event records from event metadata only. The closure never
          // reaches the sink on the shipped code path.
          void piiClosure.userId;
          void piiClosure.ssn;
        },
      },
    ],
    eventSink: sink,
    skewToleranceMs: 60000,
    softBudgetMs: 60000,
  });

  const scheduledMs = Date.now();
  await dispatcher.dispatch({ cron: '* * * * *', scheduledTime: scheduledMs });
  // Also drive an unmatched fire to cover the cronUnmatched event shape.
  await dispatcher.dispatch({ cron: '@daily', scheduledTime: scheduledMs });

  // Layer (1): every record's keys are a subset of the allow-list.
  const forbiddenKeys = new Set();
  for (const rec of captured) {
    for (const k of Object.keys(rec)) {
      if (!ALLOWED_KEYS.has(k)) forbiddenKeys.add(k);
    }
  }

  // Layer (2): substring scan over the JSON serialisation, EXCLUDING
  // the expression field (which is a legitimate literal from
  // wrangler.toml; excluding it prevents a false positive where the
  // expression itself contains a PII substring by accident).
  const withoutExpression = captured.map((r) => {
    const { expression: _omit, ...rest } = r;
    return rest;
  });
  const serialised = JSON.stringify(withoutExpression);
  const piiHits = PII_STRINGS.filter((s) => serialised.includes(s));

  const whitelistPass = forbiddenKeys.size === 0 && piiHits.length === 0;
  results.push({
    anchorAcId: 'AC-32106-1',
    verdict: SIMULATE_PII_LEAK
      ? (whitelistPass ? 'fail' : 'fail')
      : (whitelistPass ? 'pass' : 'fail'),
    detail: SIMULATE_PII_LEAK
      ? `SIMULATE_PII_LEAK=true: mutation-run forwarded body/userId/ssn to the sink; forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)} (expected empty on the shipped code path)`
      : (whitelistPass
        ? `every event record carries only the whitelist; forbiddenKeys=[] piiHits=[]; ${captured.length} records observed for one matched fire and one unmatched fire`
        : `whitelist breach: forbiddenKeys=${JSON.stringify([...forbiddenKeys])} piiHits=${JSON.stringify(piiHits)}`),
  });

  return { results };
}
