// application-onboarding-tour probe: checklist renders inside
// <details open> on the dashboard-top anchor when
// application-dashboard is applied; renders differently otherwise
// (AC-26103-1). Server-side observable: the fixture's checklistHtml
// output derived from ?apps.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26103-1';
export const accountBound = false;

function parseChecklist(body) {
  const details = body.match(/<details data-role="onboarding-tour-checklist" data-anchor="([^"]+)"(\s+open)?>/);
  const section = body.match(/<section data-role="onboarding-tour-checklist" data-anchor="([^"]+)">/);
  if (details) return { kind: 'details', anchor: details[1], open: !!details[2] };
  if (section) return { kind: 'section', anchor: section[1], open: false };
  return null;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Applied dashboard: derived anchor should be dashboard-top and
    // the checklist should render <details open>.
    const withDash = await fixtureFetch(fixture.url, '/dashboard?apps=application-dashboard');
    const parsedWith = parseChecklist(withDash.body);
    const withPass = withDash.status === 200 && !!withDash.requestId
      && parsedWith && parsedWith.kind === 'details' && parsedWith.anchor === 'dashboard-top' && parsedWith.open === true;
    results.push({
      anchorAcId,
      verdict: withPass ? 'pass' : 'fail',
      detail: withPass
        ? `GET /dashboard?apps=application-dashboard: derived checklist rendered as <details data-anchor="dashboard-top" open> as AC-26103-1 requires when application-dashboard is applied; x-fixture-request-id=${withDash.requestId}`
        : `apps=dashboard evidence gap: status=${withDash.status} rid=${withDash.requestId} parsed=${JSON.stringify(parsedWith)}`,
      evidence: {
        requestId: withDash.requestId,
        responseStatus: withDash.status,
        bodyExcerpt: excerpt((withDash.body.match(/<details data-role="onboarding-tour-checklist"[^>]{0,140}/) || [''])[0]),
        derived: { checklist: parsedWith },
      },
    });

    // Not applied: derived anchor should be settings-page and details
    // should NOT be open on the dashboard route.
    const noDash = await fixtureFetch(fixture.url, '/settings?apps=');
    const parsedNo = parseChecklist(noDash.body);
    const noPass = noDash.status === 200 && !!noDash.requestId
      && parsedNo && parsedNo.anchor === 'settings-page' && parsedNo.open === false;
    results.push({
      anchorAcId,
      verdict: noPass ? 'pass' : 'fail',
      detail: noPass
        ? `GET /settings?apps= (application-dashboard NOT applied): derived checklist rendered on settings-page anchor without the open attribute; x-fixture-request-id=${noDash.requestId}`
        : `apps=empty evidence gap: status=${noDash.status} rid=${noDash.requestId} parsed=${JSON.stringify(parsedNo)}`,
      evidence: {
        requestId: noDash.requestId,
        responseStatus: noDash.status,
        bodyExcerpt: excerpt((noDash.body.match(/<details data-role="onboarding-tour-checklist"[^>]{0,140}/) || [''])[0]),
        derived: { checklist: parsedNo },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
