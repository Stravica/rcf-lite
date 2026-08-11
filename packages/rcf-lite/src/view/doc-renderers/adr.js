// ADR renderer.

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
 * @param {object} adr
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} [ctx.errors]
 * @returns {string}
 */
export function renderAdr(adr, ctx) {
  if (!adr) return '';
  const anchor = anchorIdFor(adr.adrId ?? 'ADR');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const alts = (adr.alternativesConsidered ?? []).map((a) => `<li><strong>${escapeHtml(a.name ?? '')}</strong> - ${escapeHtml(a.summary ?? '')}<br/><em>Not chosen because:</em> ${escapeHtml(a.reasonNotChosen ?? '')}</li>`).join('');
  const supersededBy = adr.supersededBy
    ? `<p><strong>Superseded by:</strong> ${docLink(adr.supersededBy)}</p>`
    : '';
  const related = Array.isArray(adr.relatedAdrs) && adr.relatedAdrs.length > 0
    ? `<p><strong>Related ADRs:</strong> ${docLinkList(adr.relatedAdrs)}</p>`
    : '';
  return `
<article id="${anchor}" class="doc doc-adr">
  <h3>${escapeHtml(adr.adrId ?? 'ADR')} - ${escapeHtml(adr.title ?? '')}</h3>
  ${broken}
  ${fieldPara('Status', adr.status)}
  ${fieldPara('Context', adr.context)}
  ${fieldPara('Decision', adr.decision)}
  ${fieldPara('Consequences', adr.consequences)}
  ${alts ? `<section class="field-list"><h4>Alternatives considered</h4><ul>${alts}</ul></section>` : ''}
  ${supersededBy}
  ${related}
  ${rawJsonDisclosure(ctx.raw, adr, adr.adrId)}
</article>`.trim();
}
