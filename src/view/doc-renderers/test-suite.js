// Test suite renderer. Post-3.7 the TS id field is `id` (matches the
// 0.2.0 test-suite schema); inline test cases carry `id` + `acId` +
// `description` + `status` (+ optional `testPointer`).

import {
  anchorIdFor,
  brokenBanner,
  docLink,
  docLinkList,
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
  const tsId = ts.id ?? 'TS';
  const anchor = anchorIdFor(tsId);
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const tcs = (ts.testCases ?? []).map((tc) => `
<div class="tc" id="${escapeHtml(tc.id ?? '')}">
  <p><strong>${escapeHtml(tc.id ?? 'TC')}</strong> - covers ${tc.acId ? docLink(tc.acId) : 'AC'} <span class="status ${escapeHtml(tc.status ?? '')}">${escapeHtml(tc.status ?? 'pending')}</span></p>
  ${tc.description ? `<p>${escapeHtml(tc.description)}</p>` : ''}
  ${tc.testPointer ? `<p><em>Test pointer:</em> <code>${escapeHtml(tc.testPointer)}</code></p>` : ''}
</div>`.trim()).join('\n');
  return `
<article id="${anchor}" class="doc doc-ts">
  <h3>${escapeHtml(tsId)} - ${escapeHtml(ts.title ?? 'test suite')}</h3>
  ${broken}
  ${ts.usId ? `<p><strong>Verifies user story:</strong> ${docLink(ts.usId)}</p>` : ''}
  ${fieldPara('Purpose', ts.purpose)}
  ${fieldPara('Test level', ts.testLevel)}
  ${ts.acIds?.length ? `<section class="field-list"><h4>Acceptance criteria verified</h4><p>${docLinkList(ts.acIds)}</p></section>` : ''}
  ${fieldPara('Status', ts.status)}
  <section class="field-list"><h4>Test cases</h4>${tcs || '<em>no test cases</em>'}</section>
  ${rawJsonDisclosure(ctx.raw, ts, ts.id)}
</article>`.trim();
}
