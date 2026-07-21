// TAC renderer.

import {
  anchorIdFor,
  brokenBanner,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} tac
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @returns {string}
 */
export function renderTac(tac, ctx) {
  if (!tac) return '';
  const anchor = anchorIdFor(tac.tacId ?? 'TAC');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const interfaces = (tac.interfaces ?? []).map((i) => `<li><strong>${escapeHtml(i.name ?? '')}</strong> (${escapeHtml(i.kind ?? '')}) - ${escapeHtml(i.description ?? '')}</li>`).join('');
  const deps = (tac.dependencies ?? []).map((d) => `<li><strong>${escapeHtml(d.name ?? '')}</strong> (${escapeHtml(d.kind ?? '')}) - ${escapeHtml(d.description ?? '')}</li>`).join('');
  return `
<article id="${anchor}" class="doc doc-tac">
  <h3>${escapeHtml(tac.tacId ?? 'TAC')} - ${escapeHtml(tac.name ?? '')}</h3>
  ${broken}
  ${fieldPara('Purpose', tac.purpose)}
  ${fieldList('Responsibilities', tac.responsibilities)}
  ${fieldPara('Internal structure', tac.internalStructure)}
  ${interfaces ? `<section class="field-list"><h4>Interfaces</h4><ul>${interfaces}</ul></section>` : ''}
  ${deps ? `<section class="field-list"><h4>Dependencies</h4><ul>${deps}</ul></section>` : ''}
  ${fieldPara('Trade-offs', tac.tradeoffs)}
  ${fieldPara('Notes', tac.notes)}
  ${rawJsonDisclosure(ctx.raw, tac, tac.tacId)}
</article>`.trim();
}
