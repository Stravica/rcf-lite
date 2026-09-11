// application-onboarding-tour probe: first-run detection controls
// whether the tour auto-opens on /tour, /onboarding, /welcome
// (AC-26101-1). Server-side observable: the client script emits a
// FIRST_RUN constant derived from the query. The probe drives two
// varied inputs (?first-run=1 and ?first-run=0) on all three routes
// and asserts the derived constant matches.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26101-1';
export const accountBound = false;

function parseFirstRun(body) {
  const m = body.match(/var FIRST_RUN = (true|false);/);
  return m ? m[1] === 'true' : null;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    for (const route of ['/tour', '/onboarding', '/welcome']) {
      const one = await fixtureFetch(fixture.url, `${route}?first-run=1`);
      const zero = await fixtureFetch(fixture.url, `${route}?first-run=0`);
      const oneFR = parseFirstRun(one.body);
      const zeroFR = parseFirstRun(zero.body);
      const pass = one.status === 200 && zero.status === 200
        && !!one.requestId && !!zero.requestId
        && oneFR === true && zeroFR === false;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET ${route}?first-run=1 emits FIRST_RUN=true and GET ${route}?first-run=0 emits FIRST_RUN=false in the client script (derived from the varied query); x-fixture-request-id (fr=1)=${one.requestId}, (fr=0)=${zero.requestId}`
          : `${route} evidence gap: statuses=${one.status},${zero.status} rids=${one.requestId},${zero.requestId} oneFR=${oneFR} zeroFR=${zeroFR}`,
        evidence: {
          requestId: one.requestId,
          responseStatus: one.status,
          bodyExcerpt: excerpt((one.body.match(/var FIRST_RUN = (?:true|false);[^]{0,80}/) || [''])[0]),
          derived: { route, firstRunOne: oneFR, firstRunZero: zeroFR, requestIdZeroBranch: zero.requestId },
        },
      });
    }
  } finally {
    await fixture.kill();
  }
  return { results };
}
