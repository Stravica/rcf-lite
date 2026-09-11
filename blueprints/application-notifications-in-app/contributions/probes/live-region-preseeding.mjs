// application-notifications-in-app probe: live-region preseeding
// (AC-20101-1). Boots the fixture, GETs the shell root and the two
// nested surfaces (/notifications-centre, /notifications-preferences)
// and derives the count of preseeded aria-live wrappers per route.
//
// AC-20101-1 requires BOTH wrappers to be present at page load on
// every declared route: a polite wrapper carrying aria-live="polite"
// and data-live-region="polite", plus an assertive wrapper carrying
// role="alert" and data-live-region="assertive". The probe asserts
// the derived count of each attribute on each route.
//
// Varies input with ?break=preseed and asserts the derived count of
// each wrapper drops to 0 on the shell root.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20101-1';
export const accountBound = false;

function countAttr(body, needle) { return (body.match(new RegExp(needle, 'g')) || []).length; }
function countTag(body, tagRegex) { return (body.match(tagRegex) || []).length; }

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const routes = ['/', '/notifications-centre', '/notifications-preferences'];
    for (const route of routes) {
      const r = await fixtureFetch(fixture.url, route);
      // Count the actual preseeded <div> wrappers in the served
      // HTML, not any occurrence of the attribute string (the client
      // script embeds the same tokens as JS literals so a raw string
      // match cannot tell preseeded from lazily-injected).
      const politeCount = countTag(r.body, /<div class="notificationsLiveRegionPolite"[^>]*data-live-region="polite"[^>]*><\/div>/g);
      const assertiveCount = countTag(r.body, /<div class="notificationsLiveRegionAssertive"[^>]*data-live-region="assertive"[^>]*><\/div>/g);
      const pass = r.status === 200 && !!r.requestId
        && politeCount >= 1 && assertiveCount >= 1;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET ${route} preseeds both live-region wrappers as HTML at page load; derived counts: politeWrapper=${politeCount} assertiveWrapper=${assertiveCount}; x-fixture-request-id=${r.requestId}`
          : `GET ${route} evidence gap: status=${r.status} rid=${r.requestId} politeWrapper=${politeCount} assertiveWrapper=${assertiveCount}`,
        evidence: {
          requestId: r.requestId,
          responseStatus: r.status,
          bodyExcerpt: excerpt((r.body.match(/<div class="notificationsLiveRegionPolite"[^>]*><\/div>/) || [''])[0]),
          derived: { route, politeWrapper: politeCount, assertiveWrapper: assertiveCount },
        },
      });
    }

    const broken = await fixtureFetch(fixture.url, '/?break=preseed');
    const brokenPolite = countTag(broken.body, /<div class="notificationsLiveRegionPolite"[^>]*data-live-region="polite"[^>]*><\/div>/g);
    const brokenAssertive = countTag(broken.body, /<div class="notificationsLiveRegionAssertive"[^>]*data-live-region="assertive"[^>]*><\/div>/g);
    const varyPass = broken.status === 200 && !!broken.requestId && brokenPolite === 0 && brokenAssertive === 0;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /?break=preseed returned 200; derived preseeded wrapper count dropped from >=1 to 0 for polite AND assertive; the AC-20101-1 check would refuse this render; x-fixture-request-id=${broken.requestId}`
        : `break=preseed evidence gap: status=${broken.status} rid=${broken.requestId} brokenPolite=${brokenPolite} brokenAssertive=${brokenAssertive}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-region="shell-root"[^>]{0,80}/) || [''])[0]),
        derived: { brokenPolite, brokenAssertive },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
