// Test suite renderer. Inline TCs use Given/When/Then formatting. Phase 3
// does not author TS files; the renderer is here so a future phase that
// writes them gets a clean surface without revisiting the view layer.

import {
  anchorIdFor,
  brokenBanner,
  docLink,
  escapeHtml,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} ts
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @returns {string}
 */
export function renderTestSuite(ts, ctx) {
  if (!ts) return '';
  const anchor = anchorIdFor(ts.tsId ?? 'TS');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const tcs = (ts.testCases ?? []).map((tc) => `
<div class="tc">
  <p><strong>${escapeHtml(tc.tcId ?? tc.id ?? 'TC')}</strong></p>
  ${tc.given ? `<p><em>Given</em> ${escapeHtml(tc.given)}</p>` : ''}
  ${tc.when ? `<p><em>When</em> ${escapeHtml(tc.when)}</p>` : ''}
  ${tc.then ? `<p><em>Then</em> ${escapeHtml(tc.then)}</p>` : ''}
</div>`.trim()).join('\n');
  return `
<article id="${anchor}" class="doc doc-ts">
  <h3>${escapeHtml(ts.tsId ?? 'TS')} - test suite</h3>
  ${broken}
  ${ts.acId ? `<p><strong>Covers AC:</strong> ${docLink(ts.acId)}</p>` : ''}
  ${fieldPara('Description', ts.description)}
  <section class="field-list"><h4>Test cases</h4>${tcs || '<em>no test cases</em>'}</section>
  ${rawJsonDisclosure(ctx.raw, ts)}
</article>`.trim();
}
