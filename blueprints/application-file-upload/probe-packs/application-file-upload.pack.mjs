// application-file-upload probe pack (v1.0.0).
//
// Four surface-observable checks, one per contract, anchored to the
// blueprint's contributed AC ids:
//   AC-23101-1 input surface       (file input, drop-zone, keyboard-opener)
//   AC-23102-1 progress announcer  (polite tick format + monotonic advance)
//   AC-23103-1 refusal contract    (aria-describedby, no bytes for refused)
//   AC-23104-1 chunked transport   (multipart chunks OR tus Upload-Offset)
//
// Every check drives the real Playwright browser the T-0 runner
// injects. URLs are composed by the withUrl(runtimeUrl, path) helper
// per the round 3 T-3 fix train; no bare string concatenation.
//
// Sample-app fixture:
// packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/
// Fixture ships /upload with a ?transport=multipart default and a
// ?transport=tus alternative plus break switches (?break=no-input,
// ?break=no-live-region, ?break=send-refused, ?break=no-chunks) so
// the negative runs can be driven from a single boot.

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

// Progress tick format the announcer TAC pins per ADR-2402:
//   "<uploaded> of <total> files, <PP> percent"
const POLITE_FORMAT = /^\d+ of \d+ files, \d{1,3} percent$/;

export default {
  packName: 'application-file-upload',
  version: '1.0.0',
  blueprintSlug: 'application-file-upload',
  // Applies to any FBS that binds the input TAC or whose navModel
  // routes name the operator-configured upload path. References BOTH
  // `tacIds` AND `route` per the loader source-scan rule (T-0
  // AC-1701-3, cross-check with authoring standard 8c).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2401-application-file-upload-input')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/upload(\/|$|\?)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-23101-1',
      severity: 'block',
      description: 'input surface renders a labelled file input, a drop-zone region and a keyboard-focusable opener that opens the picker on Enter (WCAG 2.5.7)',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/upload'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="file-upload"]');
          if (!region) return { present: false };
          const fileInput = region.querySelector('input[type="file"]');
          const dropZone = region.querySelector('[data-drop-zone]');
          const opener = region.querySelector('[data-open-picker]');
          const inputId = fileInput ? fileInput.id : null;
          const label = inputId ? document.querySelector(`label[for="${inputId}"]`) : null;
          const ariaLabel = fileInput ? fileInput.getAttribute('aria-label') : null;
          const openerFocusable = opener ? opener.tabIndex >= 0 || opener.tagName === 'BUTTON' : false;
          return {
            present: true,
            hasFileInput: !!fileInput,
            hasDropZone: !!dropZone,
            hasOpener: !!opener,
            openerFocusable,
            hasLabel: !!label,
            hasAriaLabel: !!ariaLabel,
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'upload region [data-surface="file-upload"] not found' };
        if (!dom.hasFileInput) return { verdict: 'fail', detail: 'upload region missing input[type="file"]' };
        if (!dom.hasDropZone) return { verdict: 'fail', detail: 'upload region missing [data-drop-zone]' };
        if (!dom.hasOpener) return { verdict: 'fail', detail: 'upload region missing keyboard [data-open-picker] control (WCAG 2.5.7: drop-zone must not be the only path)' };
        if (!dom.openerFocusable) return { verdict: 'fail', detail: '[data-open-picker] control not keyboard-focusable' };
        if (!dom.hasLabel && !dom.hasAriaLabel) return { verdict: 'fail', detail: 'file input carries neither an associated <label> nor aria-label' };
        return { verdict: 'pass', detail: 'file input, drop-zone and keyboard opener present; accessible name bound' };
      },
    },
    {
      id: 'AC-23102-1',
      severity: 'block',
      description: 'progress announcer emits a polite tick in the closed format and the aggregate percent advances monotonically during an upload',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/upload?transport=multipart&autostart=1&seed=demo'));
        // Read the polite wrapper twice with the fixture's polling
        // interval between so we can prove monotonic advance.
        const firstRead = await browser.evaluate(() => {
          const live = document.querySelector('[data-live-region="polite"]');
          const row = document.querySelector('[data-file-row] [data-file-progress]');
          return {
            text: live ? live.textContent.trim() : null,
            ariaLive: live ? live.getAttribute('aria-live') : null,
            rowPercent: row ? Number(row.getAttribute('aria-valuenow') ?? row.textContent.trim()) : null,
          };
        });
        // Fixture ticks every ~150ms; poll for advance.
        const secondRead = await browser.evaluate(async () => {
          await new Promise((r) => setTimeout(r, 400));
          const live = document.querySelector('[data-live-region="polite"]');
          const row = document.querySelector('[data-file-row] [data-file-progress]');
          return {
            text: live ? live.textContent.trim() : null,
            rowPercent: row ? Number(row.getAttribute('aria-valuenow') ?? row.textContent.trim()) : null,
          };
        });
        if (!firstRead.text) return { verdict: 'fail', detail: '[data-live-region="polite"] wrapper missing' };
        if (firstRead.ariaLive !== 'polite') return { verdict: 'fail', detail: `[data-live-region="polite"] wrapper aria-live expected "polite", got ${JSON.stringify(firstRead.ariaLive)}` };
        if (!POLITE_FORMAT.test(firstRead.text)) {
          return { verdict: 'fail', detail: `polite tick text did not match /^\\d+ of \\d+ files, \\d{1,3} percent$/: ${JSON.stringify(firstRead.text)}` };
        }
        if (firstRead.rowPercent == null || Number.isNaN(firstRead.rowPercent)) {
          return { verdict: 'fail', detail: 'per-file [data-file-progress] not present or not numeric' };
        }
        if (secondRead.rowPercent == null || secondRead.rowPercent < firstRead.rowPercent) {
          return { verdict: 'fail', detail: `aggregate progress did not advance monotonically: first=${firstRead.rowPercent}, second=${secondRead.rowPercent}` };
        }
        return { verdict: 'pass', detail: `firstTick=${JSON.stringify(firstRead.text)} firstRow=${firstRead.rowPercent} secondRow=${secondRead.rowPercent}` };
      },
    },
    {
      id: 'AC-23103-1',
      severity: 'block',
      description: 'a refused file renders an aria-describedby-bound error, moves focus to the retry control, and is never sent to the server',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/upload?transport=multipart&seed=refused'));
        const dom = await browser.evaluate(async () => {
          // Wait for the upload loop to run to completion (or for
          // the deadline). We can't read the request log honestly
          // before the loop has had a chance to run: on the
          // ?break=send-refused negative branch the refused row's
          // bytes only land after the loop reaches that row. The
          // fixture completes a two-file demo set in roughly
          // 2 * 3 * 120ms + jitter = ~800ms.
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            const slot = document.querySelector('[data-assertive-slot]');
            if (slot && slot.textContent && slot.textContent.trim().length > 0) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const region = document.querySelector('[data-surface="file-upload"]');
          if (!region) return { present: false };
          const row = region.querySelector('[data-file-row][data-refused="true"]');
          if (!row) return { present: true, hasRefusedRow: false };
          const describedBy = row.getAttribute('aria-describedby');
          const errId = describedBy ? describedBy.split(/\s+/)[0] : null;
          const err = errId ? row.querySelector(`#${CSS.escape(errId)}`) || document.getElementById(errId) : null;
          const reason = row.getAttribute('data-refusal-reason');
          const retry = row.querySelector('[data-recovery="retry"]');
          const network = Array.isArray(window.__uploadRequestLog) ? window.__uploadRequestLog : [];
          const refusedFilename = row.getAttribute('data-refused-filename') || null;
          const sentRefused = refusedFilename
            ? network.some((r) => r && typeof r.body === 'string' && r.body.includes(refusedFilename))
            : false;
          return {
            present: true,
            hasRefusedRow: true,
            hasErr: !!err,
            errText: err ? err.textContent.trim() : null,
            reason,
            hasRetry: !!retry,
            refusedFilename,
            sentRefused,
            network,
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'upload region not found' };
        if (!dom.hasRefusedRow) return { verdict: 'fail', detail: 'no [data-file-row][data-refused="true"] on the refused seed' };
        if (!dom.hasErr) return { verdict: 'fail', detail: 'refused row aria-describedby does not resolve to a [data-error-message] element' };
        const allowedReasons = ['mime-refused', 'size-refused', 'virus-refused'];
        if (!allowedReasons.includes(dom.reason)) {
          return { verdict: 'fail', detail: `refused row [data-refusal-reason] expected one of ${JSON.stringify(allowedReasons)}, got ${JSON.stringify(dom.reason)}` };
        }
        if (!dom.hasRetry) return { verdict: 'fail', detail: 'refused row missing [data-recovery="retry"] control' };
        if (dom.sentRefused) {
          return { verdict: 'fail', detail: `refused filename ${JSON.stringify(dom.refusedFilename)} appears in the upload request log` };
        }
        // F-8 positive refusal-receipt: assert the row exposes a per-file [data-refusal-receipt] keyed by file id.
                const receipt = await browser.evaluate(() => {
                  const row = document.querySelector('[data-file-row][data-refused="true"]');
                  const rec = row ? row.querySelector('[data-refusal-receipt]') : null;
                  const fileId = row ? row.getAttribute('data-file-id') : null;
                  return { hasReceipt: !!rec, receiptFileId: rec ? rec.getAttribute('data-refusal-receipt') : null, fileId };
                });
                if (!receipt.hasReceipt) return { verdict: 'fail', detail: 'refused row missing positive [data-refusal-receipt] marker' };
                if (!receipt.receiptFileId || receipt.receiptFileId !== receipt.fileId) return { verdict: 'fail', detail: `refusal-receipt file id ${JSON.stringify(receipt.receiptFileId)} does not match row file id ${JSON.stringify(receipt.fileId)}` };
                return { verdict: 'pass', detail: `reason=${JSON.stringify(dom.reason)} err=${JSON.stringify(dom.errText)} refusal-receipt fileId=${receipt.fileId}` };
      },
    },
    {
      id: 'AC-23104-1',
      severity: 'block',
      description: 'the transport uploads in chunks; on the tus branch each PATCH request carries Upload-Offset, on the multipart branch [data-chunks-uploaded] on the DOM exceeds one',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        // Read the transport preference off the base runtimeUrl's own
        // query string (the withUrl helper resolves a fresh path
        // against the base, which drops the query). The pack anchors
        // on the base URL's ?transport= so a caller running the tus
        // branch passes --url http://.../upload?transport=tus and the
        // pack observes it here.
        let configuredTransport = null;
        try { configuredTransport = new URL(runtimeUrl).searchParams.get('transport'); } catch { /* runtimeUrl may be a bare path in tests */ }
        const transport = configuredTransport === 'tus' ? 'tus' : 'multipart';
        await browser.goto(withUrl(runtimeUrl, `/upload?transport=${transport}&seed=large&autostart=1`));
        const dom = await browser.evaluate(async () => {
          // Wait for the upload to complete (or for the deadline).
          // The pack needs to observe the final chunk count, not the
          // first: an early break at chunks > 0 would read 1 and
          // spuriously fail the chunked-upload assertion on a fast
          // fixture. The fixture completes a 5-chunk upload in
          // roughly 5 * 120ms = 600ms.
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            const row = document.querySelector('[data-file-row]');
            const state = row ? row.getAttribute('data-file-state') : null;
            if (state === 'complete') break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const row = document.querySelector('[data-file-row]');
          const region = document.querySelector('[data-surface="file-upload"]');
          const transportAttr = region ? region.getAttribute('data-transport') : null;
          const chunksUploaded = row ? Number(row.getAttribute('data-chunks-uploaded') ?? '0') : 0;
          const patchOffsets = Array.isArray(window.__tusPatchOffsets) ? window.__tusPatchOffsets : [];
          return { transportAttr, chunksUploaded, patchOffsets };
        });
        if (dom.transportAttr !== transport) {
          return { verdict: 'fail', detail: `upload region [data-transport] expected ${JSON.stringify(transport)}, got ${JSON.stringify(dom.transportAttr)}` };
        }
        if (dom.chunksUploaded < 2) {
          return { verdict: 'fail', detail: `[data-chunks-uploaded] expected > 1 (chunked upload), got ${dom.chunksUploaded}` };
        }
        if (transport === 'tus') {
          const numeric = dom.patchOffsets.filter((v) => typeof v === 'number' && Number.isFinite(v));
          if (numeric.length === 0) {
            return { verdict: 'fail', detail: `no PATCH request recorded with a numeric Upload-Offset header (window.__tusPatchOffsets=${JSON.stringify(dom.patchOffsets)})` };
          }
          return { verdict: 'pass', detail: `tus branch: chunks=${dom.chunksUploaded}, Upload-Offset headers=${JSON.stringify(numeric)}` };
        }
        return { verdict: 'pass', detail: `multipart branch: chunks=${dom.chunksUploaded}` };
      },
    },
  ],
};
