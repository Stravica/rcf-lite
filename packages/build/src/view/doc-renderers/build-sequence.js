// Build Sequence renderer. Post-3.7 (D15) the ordered FBS slot list is not
// read from the removed `bs.fbs[]` array but computed by the caller and
// passed via `ctx.slots` -- a list of `{ fbsId, buildOrder, executionStatus,
// title? }` sorted by buildOrder ascending.

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
 * @param {Array<{ fbsId: string, buildOrder: number, executionStatus?: string, title?: string }>} [ctx.slots]
 * @returns {string}
 */
export function renderBuildSequence(bs, ctx) {
  if (!bs) return '';
  const anchor = anchorIdFor(bs.bsId ?? 'BS');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const slots = Array.isArray(ctx.slots)
    ? [...ctx.slots].sort((a, b) => (a.buildOrder ?? 0) - (b.buildOrder ?? 0))
    : [];
  const slotList = slots.map((s) => `<li><strong>${s.buildOrder ?? '?'}.</strong> ${docLink(s.fbsId)} - <span class="status ${escapeHtml(s.executionStatus ?? '')}">${escapeHtml(s.executionStatus ?? 'unknown')}</span>${s.title ? ` - ${escapeHtml(s.title)}` : ''}</li>`).join('');
  return `
<article id="${anchor}" class="doc doc-bs">
  <h3>${escapeHtml(bs.bsId ?? 'BS')} - ${escapeHtml(bs.title ?? 'Build sequence')}</h3>
  ${broken}
  ${fieldPara('Build philosophy', bs.buildPhilosophy)}
  ${fieldPara('Generation strategy', bs.generationStrategy)}
  <section class="field-list"><h4>FBS slots</h4><ol>${slotList}</ol></section>
  ${rawJsonDisclosure(ctx.raw, bs, bs.bsId)}
</article>`.trim();
}
