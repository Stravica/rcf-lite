// application-empty-error-states probe: error-boundary state
// (AC-22108-1)  -  the alert region only renders under ?crash=1.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22108-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const standby = await fixtureFetch(fixture.url, '/probe/error-boundary');
    const noAlert = !/data-surface="error-boundary"[^>]*role="alert"/.test(standby.body);
    const standbyPass = standby.status === 200 && !!standby.requestId && noAlert;
    results.push({
      anchorAcId,
      verdict: standbyPass ? 'pass' : 'fail',
      detail: standbyPass
        ? `GET /probe/error-boundary (no crash) returned 200 with no error-boundary alert region rendered (standby posture); x-fixture-request-id=${standby.requestId}`
        : `standby evidence gap: status=${standby.status} rid=${standby.requestId} noAlert=${noAlert}`,
      evidence: {
        requestId: standby.requestId,
        responseStatus: standby.status,
        bodyExcerpt: excerpt((standby.body.match(/<section[^>]{0,80}>/) || [''])[0]),
        derived: { noAlert },
      },
    });

    const crash = await fixtureFetch(fixture.url, '/probe/error-boundary?crash=1');
    const alertRegion = /data-surface="error-boundary"[^>]*role="alert"/.test(crash.body);
    const retryControl = /data-recovery="retry"/.test(crash.body);
    const errorClass = /data-error-class="render-failure"/.test(crash.body);
    const crashPass = crash.status === 200 && !!crash.requestId && alertRegion && retryControl && errorClass;
    results.push({
      anchorAcId,
      verdict: crashPass ? 'pass' : 'fail',
      detail: crashPass
        ? `GET /probe/error-boundary?crash=1 returned 200; derived role="alert" region with retry recovery and data-error-class="render-failure" present as AC-22108-1 requires; x-fixture-request-id=${crash.requestId}`
        : `crash evidence gap: status=${crash.status} rid=${crash.requestId} alert=${alertRegion} retry=${retryControl} errorClass=${errorClass}`,
      evidence: {
        requestId: crash.requestId,
        responseStatus: crash.status,
        bodyExcerpt: excerpt((crash.body.match(/data-surface="error-boundary"[^]{0,200}/) || [''])[0]),
        derived: { alertRegion, retryControl, errorClass },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
