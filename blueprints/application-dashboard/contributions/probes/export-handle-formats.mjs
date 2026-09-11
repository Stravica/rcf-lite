// export-handle-formats probe for application-dashboard v1.0.8.
//
// AC-19106-1 (server-observable half): the export handle region
// carries a labelled button with aria-haspopup="listbox" AND a
// role="listbox" enumerating the applied formats. The fixture
// accepts a startServer({ exportFormats: [...] }) override so the
// probe DRIVES two distinct format sets and asserts the rendered
// listbox follows the input (closure 3 item 9). Browser-observable
// activation and focus-return are covered by the conformanceOnly
// limitation on the single row.
//
// anchorAcId: application-dashboard-AC-19106-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-005';
export const accountBound = false;

async function driveOne(startServer, formatsInput) {
  const started = await startServer({ port: 0, exportFormats: formatsInput });
  const baseUrl = `http://127.0.0.1:${started.port}`;
  const close = () => new Promise((res, rej) => started.server.close((e) => (e ? rej(e) : res())));
  try {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    const exportRegion = body.match(/<section[^>]+data-region="export-handle"[^>]*>([\s\S]*?)<\/section>/);
    const inner = exportRegion ? exportRegion[1] : '';
    const hasBtn = /<button[^>]+aria-haspopup="listbox"[^>]*>/.test(inner);
    const listbox = /<ul[^>]+role="listbox"[^>]*>/.test(inner);
    const formats = Array.from(inner.matchAll(/data-export-format="([^"]+)"/g)).map((m) => m[1]);
    const followsInput = formats.length === formatsInput.length
      && formatsInput.every((f) => formats.includes(f))
      && formats.every((f) => formatsInput.includes(f));
    return { res, body, hasBtn, listbox, formats, followsInput, close };
  } catch (e) { try { await close(); } catch {} throw e; }
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');

  const results = [];
  const shipped = ['csv', 'pdf', 'png-chart'];
  const elicited = ['csv', 'xlsx', 'json', 'png-chart'];
  const runA = await driveOne(startServer, shipped);
  try {
    const runB = await driveOne(startServer, elicited);
    try {
      const derived = runA.followsInput && runB.followsInput
        && JSON.stringify(runA.formats) !== JSON.stringify(runB.formats);
      const pass = runA.res.status === 200 && runB.res.status === 200 && runA.hasBtn && runA.listbox && runB.hasBtn && runB.listbox && derived;
      results.push(conformanceOnlyResult({
        anchorAcId: 'application-dashboard-AC-19106-1',
        anchorReqId: 'application-dashboard-REQ-005',
        verdict: pass ? 'pass' : 'fail',
        detail: `Given a rendered dashboard surface, the export handle - drove two distinct format sets: runA=[${runA.formats.join(',')}] runB=[${runB.formats.join(',')}]; listbox follows input (${derived})`,
        evidence: evidenceFromResponse({
          route: '/',
          response: runB.res,
          bodyText: runB.body,
          extraFields: {
            input: { runA: shipped, runB: elicited },
            derived: { runAFormats: runA.formats, runBFormats: runB.formats, followsInput: derived, hasButtonA: runA.hasBtn, hasButtonB: runB.hasBtn },
            altBodyExcerpt: runA.body.slice(0, 240),
          },
        }),
        limitation: 'application-dashboard-AC-19106-1: control activation and Escape/focus-return are browser-only',
      }));
    } finally { await runB.close(); }
  } finally { await runA.close(); }
  return { results };
}
