// health-probes-distinct probe for application-api-rest v2.1.10.
//
// AC-2108-1: liveness returns 200 with no dependency checks whatsoever.
// AC-2108-2: readiness returns 200 only when every declared check passes.
// AC-2108-4: startup returns 200 only after initialisation completes.
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-006';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // AC-2108-1: liveness is 200 regardless of dependency availability.
    // The derivation is that varying ?deps= does NOT change the returned
    // status, and the response records dependencyChecksPerformed=0.
    const liveUp = await fetch(`${fixture.baseUrl}/livez?deps=up`);
    const liveUpBody = await liveUp.text();
    const liveUpJson = JSON.parse(liveUpBody);
    const liveDown = await fetch(`${fixture.baseUrl}/livez?deps=down`);
    const liveDownBody = await liveDown.text();
    const liveDownJson = JSON.parse(liveDownBody);
    const liveUnknown = await fetch(`${fixture.baseUrl}/livez?deps=unknown`);
    const liveUnknownBody = await liveUnknown.text();
    const liveUnknownJson = JSON.parse(liveUnknownBody);
    const allTwoHundred = liveUp.status === 200 && liveDown.status === 200 && liveUnknown.status === 200;
    const noDepsChecked = liveUpJson.dependencyChecksPerformed === 0
      && liveDownJson.dependencyChecksPerformed === 0
      && liveUnknownJson.dependencyChecksPerformed === 0;
    const livenessOk = allTwoHundred && noDepsChecked;
    results.push({
      anchorAcId: 'application-api-rest-AC-2108-1',
      verdict: livenessOk ? 'pass' : 'fail',
      detail: `GET on the resolved liveness path returns 200 - /livez returned ${liveUp.status}/${liveDown.status}/${liveUnknown.status} across ?deps=up|down|unknown; dependencyChecksPerformed reported ${liveUpJson.dependencyChecksPerformed}/${liveDownJson.dependencyChecksPerformed}/${liveUnknownJson.dependencyChecksPerformed}`,
      evidence: evidenceFromResponse({
        route: '/livez?deps=down',
        response: liveDown,
        bodyText: liveDownBody,
        extraFields: {
          input: { depsSequence: ['up', 'down', 'unknown'] },
          derived: {
            statuses: [liveUp.status, liveDown.status, liveUnknown.status],
            dependencyChecksPerformed: [liveUpJson.dependencyChecksPerformed, liveDownJson.dependencyChecksPerformed, liveUnknownJson.dependencyChecksPerformed],
            unaffectedByDependencyOutage: livenessOk,
          },
          altBodyExcerpt: liveUpBody.slice(0, 240),
        },
      }),
    });

    // AC-2108-2: readiness returns 200 only when every declared check passes.
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
      verdict: readinessDerived ? 'pass' : 'fail',
      detail: `GET on the resolved readiness path returns 200 - /readyz enumerates ${readyUpJson.checks?.length ?? 0} declared checks; all pass in up-state (${readyUp.status}), at least one down in down-state (${readyDown.status})`,
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

    // AC-2108-4: startup returns 200 only after initialisation completes.
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
      verdict: startupDerived ? 'pass' : 'fail',
      detail: `GET on the resolved startup path returns 200 - /startupz drives ${startupInitJson.pending?.length ?? 0} pending steps in init-state (${startupInit.status}) and ${startupCompleteJson.pending?.length ?? 0} in complete-state (${startupComplete.status})`,
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
