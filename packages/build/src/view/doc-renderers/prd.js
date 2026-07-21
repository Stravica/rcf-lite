// PRD renderer. Curated fields per spec D11. Post-3.7 (D15) the child REQ
// list is not read from `prd.requirementIds` (removed in 0.2.0) but from
// the computed `childrenByParent` map on the tree model.

import {
  anchorIdFor,
  brokenBanner,
  docLinkList,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} prd
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @param {string[]} [ctx.requirementIds] - computed REQ children for this PRD
 * @returns {string}
 */
export function renderPrd(prd, ctx) {
  if (!prd) return '';
  const anchor = anchorIdFor(prd.prdId ?? 'PRD');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const requirementIds = ctx.requirementIds ?? [];
  const sections = [
    fieldPara('Executive summary', prd.executiveSummary),
    fieldPara('Problem statement', prd.problemStatement),
    fieldList('Target users', prd.targetUsers),
    fieldList('In scope', prd.inScope),
    fieldList('Out of scope', prd.outOfScope),
    fieldList('Objectives', prd.objectives),
    fieldList('Constraints', prd.constraints),
    `<section class="field-list"><h4>Requirements</h4><p>${docLinkList(requirementIds)}</p></section>`,
  ].filter(Boolean).join('\n');
  return `
<article id="${anchor}" class="doc doc-prd">
  <h3>${escapeHtml(prd.prdId ?? 'PRD')} - ${escapeHtml(prd.productName ?? '')}</h3>
  ${broken}
  ${sections}
  ${rawJsonDisclosure(ctx.raw, prd, prd.prdId)}
</article>`.trim();
}
