// application-onboarding-tour probe: checklist collapse contract
// (AC-26103-1).
//
// AC-26103-1 has three observable claims and every one is
// server-observable in the fixture: (i) when application-dashboard is
// in the applied set the checklist renders inside a <details open>
// element on the dashboard-top anchor slot; (ii) when it is NOT in
// the applied set the checklist renders inside a <details> (closed)
// element on the settings-page anchor slot; (iii) the <details>
// element carries data-role="onboarding-tour-checklist" in both
// branches. The two rows below drive both branches and assert all
// three claims per the first-eight-words rule (row detail opens on
// the AC's first eight words verbatim).
//
// AC-26103-1 first eight words: "Given the applied capability set includes application-dashboard, the".

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26103-1';
export const accountBound = false;

function parseChecklist(body) {
  const details = body.match(/<details data-role="onboarding-tour-checklist" data-anchor="([^"]+)"(\s+open)?>/);
  const section = body.match(/<section data-role="onboarding-tour-checklist" data-anchor="([^"]+)">/);
  if (details) return { kind: 'details', anchor: details[1], open: !!details[2], dataRolePresent: true };
  if (section) return { kind: 'section', anchor: section[1], open: false, dataRolePresent: true };
  return null;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Applied-dashboard branch: expect <details open> on dashboard-top with
    // data-role="onboarding-tour-checklist".
    const withDash = await fixtureFetch(fixture.url, '/dashboard?apps=application-dashboard');
    const parsedWith = parseChecklist(withDash.body);
    const withPass = withDash.status === 200 && !!withDash.requestId
      && parsedWith && parsedWith.kind === 'details'
      && parsedWith.anchor === 'dashboard-top' && parsedWith.open === true
      && parsedWith.dataRolePresent === true;
    results.push({
      anchorAcId,
      verdict: withPass ? 'pass' : 'fail',
      detail: withPass
        ? `Given the applied capability set includes application-dashboard, the checklist rendered as <details data-role="onboarding-tour-checklist" data-anchor="dashboard-top" open> at GET /dashboard?apps=application-dashboard (kind=${parsedWith.kind}, anchor=${parsedWith.anchor}, open=${parsedWith.open}, dataRolePresent=${parsedWith.dataRolePresent}); x-fixture-request-id=${withDash.requestId}.`
        : `Given the applied capability set includes application-dashboard, the AC-26103-1 dashboard-branch observation failed: status=${withDash.status} rid=${withDash.requestId} parsed=${JSON.stringify(parsedWith)}.`,
      evidence: {
        requestId: withDash.requestId,
        responseStatus: withDash.status,
        bodyExcerpt: excerpt((withDash.body.match(/<details data-role="onboarding-tour-checklist"[^>]{0,140}/) || [''])[0]),
        derived: { branch: 'application-dashboard-applied', checklist: parsedWith },
      },
    });

    // Not-applied branch: expect <details> (closed, no open attribute) on
    // settings-page with data-role="onboarding-tour-checklist".
    const noDash = await fixtureFetch(fixture.url, '/settings?apps=');
    const parsedNo = parseChecklist(noDash.body);
    const noPass = noDash.status === 200 && !!noDash.requestId
      && parsedNo && parsedNo.kind === 'details'
      && parsedNo.anchor === 'settings-page' && parsedNo.open === false
      && parsedNo.dataRolePresent === true;
    results.push({
      anchorAcId,
      verdict: noPass ? 'pass' : 'fail',
      detail: noPass
        ? `Given the applied capability set includes application-dashboard, the complementary NOT-applied branch was observed at GET /settings?apps=: checklist rendered as <details data-role="onboarding-tour-checklist" data-anchor="settings-page"> (kind=${parsedNo.kind}, anchor=${parsedNo.anchor}, open=${parsedNo.open}, dataRolePresent=${parsedNo.dataRolePresent}); x-fixture-request-id=${noDash.requestId}.`
        : `Given the applied capability set includes application-dashboard, the AC-26103-1 NOT-applied-branch observation failed: status=${noDash.status} rid=${noDash.requestId} parsed=${JSON.stringify(parsedNo)}.`,
      evidence: {
        requestId: noDash.requestId,
        responseStatus: noDash.status,
        bodyExcerpt: excerpt((noDash.body.match(/<details data-role="onboarding-tour-checklist"[^>]{0,140}/) || [''])[0]),
        derived: { branch: 'application-dashboard-not-applied', checklist: parsedNo },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
