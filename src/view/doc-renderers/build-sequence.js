// Build Sequence renderer.

import {
  anchorIdFor,
  brokenBanner,
  docLink,
  escapeHtml,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} bs
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @returns {string}
 */
export function renderBuildSequence(bs, ctx) {
  if (!bs) return '';
  const anchor = anchorIdFor(bs.bsId ?? 'BS');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const slots = Array.isArray(bs.fbs) ? [...bs.fbs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const slotList = slots.map((s) => `<li><strong>${s.order ?? '?'}.</strong> ${docLink(s.fbsId)} - <span class="status ${escapeHtml(s.status ?? '')}">${escapeHtml(s.status ?? 'unknown')}</span>${s.notes ? ` - ${escapeHtml(s.notes)}` : ''}</li>`).join('');
  return `
<article id="${anchor}" class="doc doc-bs">
  <h3>${escapeHtml(bs.bsId ?? 'BS')} - ${escapeHtml(bs.title ?? 'Build sequence')}</h3>
  ${broken}
  ${fieldPara('Build philosophy', bs.buildPhilosophy)}
  ${fieldPara('Generation strategy', bs.generationStrategy)}
  <section class="field-list"><h4>FBS slots</h4><ol>${slotList}</ol></section>
  ${rawJsonDisclosure(ctx.raw, bs)}
</article>`.trim();
}
