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
 * @param {import('#core/errors').RcfError[]} [ctx.errors]
 * @param {string[]} [ctx.requirementIds] - computed REQ children for this PRD
 * @param {boolean} [ctx.suppressRequirementList] - viewer UI refresh PR 3
 *   (decision 4): the PRD tab replaces the inline doc-link paragraph with
 *   an EntitySelector mounted outside this article, so renderPrd no
 *   longer emits the 109 inline requirement anchors when that flag is on.
 *   Non-tab callers (if any) still see the legacy paragraph by default.
 * @param {boolean} [ctx.collapsibleLists] - viewer UI refresh PR 3 (design
 *   section 5): the PRD tab collapses Target users / In scope / Out of
 *   scope / Objectives / Constraints each with a count badge; Executive
 *   summary and Problem statement stay open. Non-tab callers (if any)
 *   still see the open sections by default.
 * @returns {string}
 */
export function renderPrd(prd, ctx) {
  if (!prd) return '';
  const anchor = anchorIdFor(prd.prdId ?? 'PRD');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const requirementIds = ctx.requirementIds ?? [];
  const requirementSection = ctx.suppressRequirementList
    ? ''
    : `<section class="field-list"><h4>Requirements</h4><p>${docLinkList(requirementIds)}</p></section>`;
  const renderList = ctx.collapsibleLists ? collapsibleFieldList : fieldList;
  const sections = [
    fieldPara('Executive summary', prd.executiveSummary),
    fieldPara('Problem statement', prd.problemStatement),
    renderList('Target users', prd.targetUsers),
    renderList('In scope', prd.inScope),
    renderList('Out of scope', prd.outOfScope),
    renderList('Objectives', prd.objectives),
    renderList('Constraints', prd.constraints),
    requirementSection,
  ].filter(Boolean).join('\n');
  return `
<article id="${anchor}" class="doc doc-prd">
  <h3>${escapeHtml(prd.prdId ?? 'PRD')} - ${escapeHtml(prd.productName ?? '')}</h3>
  ${broken}
  ${sections}
  ${rawJsonDisclosure(ctx.raw, prd, prd.prdId)}
</article>`.trim();
}

/**
 * Collapsible variant of `fieldList`: a <details> whose summary names
 * the field and carries the count badge, body is the same `<ul>` list.
 * The count badge uses the shared Badge class names so it looks the
 * same as the Requirements-tab counts.
 *
 * @param {string} label
 * @param {string[] | undefined} items
 */
function collapsibleFieldList(label, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const li = items.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<details class="rcf-prd-list field-list"><summary><strong>${escapeHtml(label)}</strong> <span class="rcf-badge rcf-badge--count"><span class="rcf-badge-value">${items.length}</span></span></summary><div class="rcf-prd-list-body"><ul>${li}</ul></div></details>`;
}
