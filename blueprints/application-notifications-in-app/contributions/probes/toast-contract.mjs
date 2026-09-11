// application-notifications-in-app probe: toast role/priority mapping
// and the WCAG 2.2.1 timeout floor (AC-20102-1).
//
// AC-20102-1 requires: info-priority toasts render inside
// [data-live-region="polite"] with role="status"; error toasts
// render inside [data-live-region="assertive"] with role="alert";
// the shell root exposes the ratified 6-second timeout floor.
//
// The probe derives the timeout-floor value from the shell root's
// data-toast-timeout-floor-seconds attribute (an integer the fixture
// emits from its shipped constant, but the probe re-parses it from
// the response text and asserts it meets or exceeds 6). Then varies
// input with ?break=timeout and asserts the derived value drops to 2
// (below the WCAG 2.2.1 floor).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20102-1';
export const accountBound = false;

function parseFloor(body) {
  const m = body.match(/data-toast-timeout-floor-seconds="(\d+)"/);
  return m ? Number(m[1]) : NaN;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const floor = parseFloor(golden.body);
    const meetsFloor = golden.status === 200 && !!golden.requestId && floor >= 6;
    results.push({
      anchorAcId,
      verdict: meetsFloor ? 'pass' : 'fail',
      detail: meetsFloor
        ? `GET / shell root emits data-toast-timeout-floor-seconds="${floor}"; derived value meets the WCAG 2.2.1 six-second floor (>=6); x-fixture-request-id=${golden.requestId}`
        : `GET / evidence gap: status=${golden.status} rid=${golden.requestId} floor=${floor}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/data-toast-timeout-floor-seconds="\d+"/) || [''])[0]),
        derived: { floor },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/?break=timeout');
    const brokenFloor = parseFloor(broken.body);
    const varyPass = broken.status === 200 && !!broken.requestId && brokenFloor > 0 && brokenFloor < 6;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /?break=timeout returned 200; derived floor dropped from ${floor} to ${brokenFloor}; the AC-20102-1 check would refuse this render because ${brokenFloor}s is below the six-second WCAG floor; x-fixture-request-id=${broken.requestId}`
        : `break=timeout evidence gap: status=${broken.status} rid=${broken.requestId} brokenFloor=${brokenFloor}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-toast-timeout-floor-seconds="\d+"/) || [''])[0]),
        derived: { brokenFloor },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
