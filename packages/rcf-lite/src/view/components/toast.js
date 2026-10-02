// Shared Toast container (viewer UI refresh PR 2, design doc section 4):
// a single bottom-centred transient message block that lives in the
// AppShell. PR 2 ships the container markup and a tiny vanilla showToast
// helper on `window.rcfView`. The container is empty on first paint;
// the helper writes the text, flips the `.show` class, auto-hides after
// a brief delay and clears the content.
//
// Shape (uses <output> rather than <div> so the Phase 3.8 D13a
// `lastIndexOf("</div>")` live-content wrapper check in
// test/view/html-page.test.js stays unambiguous; <output> carries the
// implicit role="status" we need anyway):
//
//   <output class="rcf-toast toast" aria-live="polite" aria-atomic="true"
//           data-toast></output>
//
// Idempotent client wiring is in page-init.js; the container is
// rendered once by the AppShell so the SSE innerHTML swap (which
// replaces #rcf-live-content only) does not blow it away.

/**
 * @returns {string}
 */
export function renderToastContainer() {
  return '<output class="rcf-toast toast" aria-live="polite" aria-atomic="true" data-toast></output>';
}
