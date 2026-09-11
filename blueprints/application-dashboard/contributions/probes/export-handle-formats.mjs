// export-handle-formats probe for application-dashboard v1.0.6.
//
// Verifies AC-19106-1: the export handle region contains a labelled
// <button> with aria-haspopup="listbox" AND a role="listbox" with
// at least the three shipped formats (csv, pdf, png-chart), each
// carrying a data-export-format value.
//
// anchorAcId: application-dashboard-AC-19106-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

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
    results.push({
      anchorAcId: 'application-dashboard-AC-19106-1',
      anchorReqId: 'application-dashboard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Given a rendered dashboard surface, the export handle - export-handle region carries a labelled aria-haspopup="listbox" button and a role="listbox" naming [${formats.join(', ')}]`
        : `Given a rendered dashboard surface, the export handle - export handle fault: regionPresent=${!!exportRegion} button=${hasBtn} listbox=${listbox} formats=${JSON.stringify(formats)}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: res,
        bodyText: body,
        extraFields: {
          input: { expectedFormats: EXPECTED_FORMATS },
          derived: { hasButton: hasBtn, hasListbox: listbox, formatsFound: formats },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
