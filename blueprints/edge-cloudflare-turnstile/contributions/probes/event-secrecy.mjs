// Probe: every event record carries sitekeyHash, outcome and timestamp only; never the token, never the secret.
// anchorAcId: AC-35108-1. accountBound: false. Drives one pass and one fail through the live siteverify endpoint.

export const anchorAcId = 'AC-35108-1';
export const accountBound = false;

export default async function runProbe() {
  const { TEST_SECRETS, TEST_SITEKEYS, bootFixture } = await import('./probe-utils.mjs');
  const results = [];

  const fixture = await bootFixture({ TURNSTILE_SECRET: TEST_SECRETS.alwaysPass, TURNSTILE_SITEKEY: TEST_SITEKEYS.alwaysPass, TURNSTILE_FAIL_SECRET: TEST_SECRETS.alwaysFail });
  try {
    await fetch(`${fixture.url}/api/events/clear`, { method: 'POST' });
    // Pass branch: submit with any token.
    const passBody = new URLSearchParams();
    passBody.set('email', 'reviewer@example.com');
    passBody.set('turnstile-sitekey', TEST_SITEKEYS.alwaysPass);
    passBody.set('cf-turnstile-response', 'PASS-TOKEN-LITERAL-XYZ');
    const passResp = await fetch(`${fixture.url}/api/submit`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: passBody,
    });

    // Fail branch: submit with fail-secret=1 forcing the always-fail secret path.
    const failBody = new URLSearchParams();
    failBody.set('email', 'reviewer@example.com');
    failBody.set('turnstile-sitekey', TEST_SITEKEYS.alwaysBlock);
    failBody.set('cf-turnstile-response', 'FAIL-TOKEN-LITERAL-ABC');
    const failResp = await fetch(`${fixture.url}/api/submit?fail-secret=1`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: failBody,
    });

    const events = await (await fetch(`${fixture.url}/api/events`)).json();
    const allowed = new Set(['sitekeyHash', 'outcome', 'timestamp']);
    const extraKeyRecords = events.filter((r) => Object.keys(r).some((k) => !allowed.has(k)));
    const forbiddenSubstrings = ['PASS-TOKEN-LITERAL-XYZ', 'FAIL-TOKEN-LITERAL-ABC', TEST_SECRETS.alwaysPass, TEST_SECRETS.alwaysFail];
    const serialized = JSON.stringify(events);
    const leaks = forbiddenSubstrings.filter((s) => serialized.includes(s));
    const outcomes = events.map((e) => e.outcome).sort();
    const shapeOk = events.length === 2 && extraKeyRecords.length === 0 && leaks.length === 0
      && outcomes[0] === 'refused' && outcomes[1] === 'verified';
    results.push({
      anchorAcId: 'AC-35108-1',
      verdict: shapeOk ? 'pass' : 'fail',
      detail: shapeOk
        ? `event-secrecy: 2 events captured, keys=[sitekeyHash,outcome,timestamp] only; no token or secret leak; outcomes=${JSON.stringify(outcomes)}; passResp=${passResp.status} failResp=${failResp.status}`
        : `event-secrecy failure: events=${events.length} extraKeyRecords=${JSON.stringify(extraKeyRecords)} leaks=${JSON.stringify(leaks)} outcomes=${JSON.stringify(outcomes)} passResp=${passResp.status} failResp=${failResp.status}`,
    });
  } finally { await fixture.stop(); }

  return { results };
}
