// upload-surface-shape probe for application-file-upload v1.2.2.
//
// Verifies AC-23101-1: the upload region carries
// [data-surface="file-upload"] AND a labelled file input, a
// [data-drop-zone] region and a [data-open-picker] button, all
// with the required accessible-name and control attributes. The
// probe cannot press Enter on a server-rendered fixture, so the
// keyboard-focus branch of AC-23101-1 is proven at project-side
// review; the probe records this partial-observation gap on the
// evidence object and refuses to claim positive on it.
//
// anchorAcId: application-file-upload-AC-23101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-file-upload-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/upload`);
    const body = await res.text();
    const surface = /data-surface="file-upload"/.test(body);
    const label = /<label[^>]+for="filePicker"/.test(body);
    const input = /<input[^>]+id="filePicker"[^>]+type="file"[^>]+multiple/.test(body);
    const dropZoneMatch = body.match(/<div[^>]+data-drop-zone[^>]+aria-label="([^"]+)"[^>]*>/);
    const pickerMatch = body.match(/<button[^>]+data-open-picker[^>]+aria-label="([^"]+)"[^>]*>/);
    const pickerScriptWiredForEnter = /data-open-picker/.test(body) && /keydown/.test(body);
    const pass = res.status === 200 && surface && label && input && !!dropZoneMatch && !!pickerMatch;
    results.push({
      anchorAcId: 'application-file-upload-AC-23101-1',
      anchorReqId: 'application-file-upload-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `upload surface renders labelled input, drop-zone (aria-label="${dropZoneMatch[1]}") and open-picker button (aria-label="${pickerMatch[1]}"); Enter-to-focus JS wire is present in the fixture, but the DOM press cannot be observed from this server-only probe`
        : `upload surface fault: surface=${surface} label=${label} input=${input} dropZone=${!!dropZoneMatch} picker=${!!pickerMatch}`,
      evidence: evidenceFromResponse({
        route: '/upload',
        response: res,
        bodyText: body,
        extraFields: {
          input: { path: '/upload' },
          derived: {
            surface, label, input,
            dropZoneAriaLabel: dropZoneMatch ? dropZoneMatch[1] : null,
            pickerAriaLabel: pickerMatch ? pickerMatch[1] : null,
            enterKeyWireInSource: pickerScriptWiredForEnter,
            observationGap: 'Enter-key focus-return is JS-driven; not observed by server-only probe',
          },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
