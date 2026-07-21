// REQ renderer. Carries an optional per-REQ Mermaid subdiagram block when
// the caller passes one (the html-page module decides whether to include it).
// Child user stories are NOT rendered as inline links because the Phase 3.2
// layout nests them as `<details>` under the REQ's own `<details>` wrapper.

import {
  anchorIdFor,
  brokenBanner,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} req
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @param {string|undefined} [ctx.subdiagram]
 * @returns {string}
 */
export function renderReq(req, ctx) {
  if (!req) return '';
  const anchor = anchorIdFor(req.reqId ?? 'REQ');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const subdiagram = ctx.subdiagram
    ? `<section class="subdiagram"><h4>Slice diagram</h4><pre class="mermaid">${escapeHtml(ctx.subdiagram)}</pre></section>`
    : '';
  return `
<article id="${anchor}" class="doc doc-req">
  <h3>${escapeHtml(req.reqId ?? 'REQ')} - ${escapeHtml(req.title ?? '')}</h3>
  ${broken}
  ${fieldPara('Description', req.description)}
  ${fieldPara('Category', req.category)}
  ${fieldPara('Domain', req.domain)}
  ${fieldPara('Priority', req.priority)}
  ${fieldPara('Rationale', req.rationale)}
  ${fieldList('Tags', req.tags)}
  ${subdiagram}
  ${rawJsonDisclosure(ctx.raw, req, req.reqId)}
</article>`.trim();
}
