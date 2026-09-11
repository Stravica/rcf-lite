// export-handle-formats probe for application-dashboard v1.0.7.
//
// Server-observable half of AC-19106-1: the export handle region
// carries a labelled button with aria-haspopup="listbox" AND a
// role="listbox" enumerating the three shipped formats
// (csv, pdf, png-chart). Browser-observable parts of AC-19106-1
// (control activation, focus return on Escape) are notObservableHere.
//
// anchorAcId: application-dashboard-AC-19106-1.

import { startFixture, evidenceFromResponse, notObservableHereResult, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-005';
export const accountBound = false;

const EXPECTED_FORMATS = ['csv', 'pdf', 'png-chart'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const exportRegion = body.match(/<section[^>]+data-region="export-handle"[^>]*>([\s\S]*?)<\/section>/);
    const inner = exportRegion ? exportRegion[1] : '';
    const hasBtn = /<button[^>]+aria-haspopup="listbox"[^>]*>/.test(inner);
    const listbox = /<ul[^>]+role="listbox"[^>]*>/.test(inner);
    const formats = Array.from(inner.matchAll(/data-export-format="([^"]+)"/g)).map((m) => m[1]);
    const formatsOk = EXPECTED_FORMATS.every((f) => formats.includes(f));
    const pass = res.status === 200 && !!exportRegion && hasBtn && listbox && formatsOk;
    results.push(conformanceOnlyResult({
      anchorAcId: 'application-dashboard-AC-19106-1',
      anchorReqId: 'application-dashboard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: `Given a rendered dashboard surface, the export handle - listbox button and format enum rendered with formats=[${formats.join(', ')}] (server-observable half of AC-19106-1)`,
      evidence: evidenceFromResponse({
        route: '/',
        response: res,
        bodyText: body,
        extraFields: {
          input: { expectedFormats: EXPECTED_FORMATS },
          derived: { hasButton: hasBtn, hasListbox: listbox, formatsFound: formats },
        },
      }),
      limitation: 'application-dashboard-AC-19106-1: control activation and Escape/focus-return are browser-only',
    }));

    results.push(notObservableHereResult({
      anchorAcId: 'application-dashboard-AC-19106-1',
      anchorReqId: 'application-dashboard-REQ-005',
      ac: 'application-dashboard-AC-19106-1',
      detail: 'Given a rendered dashboard surface, the export handle - control activation and focus return on Escape are browser-only',
      reason: 'AC-19106-1 requires activating the control and observing focus return on Escape; server-side probe pack cannot observe focus movement',
      evidence: { expectedFormats: EXPECTED_FORMATS, browserBehaviour: 'click / Escape / focus-return' },
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
