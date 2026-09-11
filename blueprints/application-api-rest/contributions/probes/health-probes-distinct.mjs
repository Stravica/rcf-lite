// health-probes-distinct probe for application-api-rest v2.1.8.
//
// Verifies AC-2108-1 (liveness varies with dependency availability),
// AC-2108-2 (readiness requires every declared check to pass) and
// AC-2108-4 (startup drives both mid-initialisation and completed
// states). Each row exercises a distinct fixture state so the
// derivation is real, not fixture-constant.
//
// anchorAcId: per-row (AC-2108-1, AC-2108-2, AC-2108-4).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-006';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // AC-2108-1: liveness varies with dependency availability.
    // Drive ?deps=up and ?deps=down and derive that the status code
    // and status label change with the varied input.
    const liveUp = await fetch(`${fixture.baseUrl}/livez?deps=up`);
    const liveUpBody = await liveUp.text();
    const liveDown = await fetch(`${fixture.baseUrl}/livez?deps=down`);
    const liveDownBody = await liveDown.text();
    const derivedLiveness = { upStatus: liveUp.status, downStatus: liveDown.status };
    const livenessDerived = liveUp.status === 200 && liveDown.status === 503;
    results.push({
      anchorAcId: 'application-api-rest-AC-2108-1',
      anchorReqId: 'application-api-rest-REQ-006',
      verdict: livenessDerived ? 'pass' : 'fail',
      detail: `Probe endpoints: liveness, readiness, and startup with specified - /livez varied by ?deps= yields ${liveUp.status} (up) and ${liveDown.status} (down); derivation matches AC-2108-1: ${livenessDerived}`,
      evidence: evidenceFromResponse({
        route: '/livez?deps=up',
        response: liveUp,
        bodyText: liveUpBody,
        extraFields: {
          input: { depsSequence: ['up', 'down'] },
          derived: derivedLiveness,
          altBodyExcerpt: liveDownBody.slice(0, 240),
        },
      }),
    });

    // AC-2108-2: readiness enumerates every declared dependency
    // check and reports notReady when any check is down.
    const readyUp = await fetch(`${fixture.baseUrl}/readyz?deps=up`);
    const readyUpBody = await readyUp.text();
    const readyUpJson = JSON.parse(readyUpBody);
    const readyDown = await fetch(`${fixture.baseUrl}/readyz?deps=down`);
    const readyDownBody = await readyDown.text();
    const readyDownJson = JSON.parse(readyDownBody);
    const readinessAllChecked = Array.isArray(readyUpJson.checks) && readyUpJson.checks.every((c) => c.ok === true);
    const readinessDownDetected = readyDown.status === 503 && readyDownJson.checks.some((c) => c.ok === false);
    const readinessDerived = readyUp.status === 200 && readinessAllChecked && readinessDownDetected;
    results.push({
      anchorAcId: 'application-api-rest-AC-2108-2',
      anchorReqId: 'application-api-rest-REQ-006',
      verdict: readinessDerived ? 'pass' : 'fail',
      detail: `Probe endpoints: liveness, readiness, and startup with specified - /readyz enumerates ${readyUpJson.checks?.length ?? 0} declared checks; all pass in up-state, at least one down in down-state; readiness derivation matches AC-2108-2: ${readinessDerived}`,
      evidence: evidenceFromResponse({
        route: '/readyz?deps=up',
        response: readyUp,
        bodyText: readyUpBody,
        extraFields: {
          input: { depsSequence: ['up', 'down'] },
          derived: {
            checksInUp: readyUpJson.checks,
            checksInDown: readyDownJson.checks,
            upStatus: readyUp.status,
            downStatus: readyDown.status,
          },
          altBodyExcerpt: readyDownBody.slice(0, 240),
        },
      }),
    });

    // AC-2108-4: startup drives both mid-initialisation and
    // completed states. mid-init returns 503 with pending!=[];
    // complete returns 200 with pending==[].
    const startupInit = await fetch(`${fixture.baseUrl}/startupz?state=init`);
    const startupInitBody = await startupInit.text();
    const startupInitJson = JSON.parse(startupInitBody);
    const startupComplete = await fetch(`${fixture.baseUrl}/startupz?state=complete`);
    const startupCompleteBody = await startupComplete.text();
    const startupCompleteJson = JSON.parse(startupCompleteBody);
    const startupDerived = startupInit.status === 503
      && Array.isArray(startupInitJson.pending) && startupInitJson.pending.length > 0
      && startupComplete.status === 200
      && Array.isArray(startupCompleteJson.pending) && startupCompleteJson.pending.length === 0;
    results.push({
      anchorAcId: 'application-api-rest-AC-2108-4',
      anchorReqId: 'application-api-rest-REQ-006',
      verdict: startupDerived ? 'pass' : 'fail',
      detail: `Probe endpoints: liveness, readiness, and startup with specified - /startupz drives ${startupInitJson.pending?.length ?? 0} pending steps in init-state and ${startupCompleteJson.pending?.length ?? 0} in complete-state; both branches derived per AC-2108-4: ${startupDerived}`,
      evidence: evidenceFromResponse({
        route: '/startupz?state=init',
        response: startupInit,
        bodyText: startupInitBody,
        extraFields: {
          input: { stateSequence: ['init', 'complete'] },
          derived: {
            initStatus: startupInit.status,
            initPending: startupInitJson.pending,
            completeStatus: startupComplete.status,
            completePending: startupCompleteJson.pending,
          },
          altBodyExcerpt: startupCompleteBody.slice(0, 240),
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
