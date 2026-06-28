// User story renderer. ACs are rendered inline with Given/When/Then.

import {
  anchorIdFor,
  brokenBanner,
  docLink,
  escapeHtml,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} us
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @param {Map<string, object[]>} [ctx.fbsByAcId]
 * @returns {string}
 */
export function renderUserStory(us, ctx) {
  if (!us) return '';
  const anchor = anchorIdFor(us.usId ?? 'US');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const acBlocks = (us.acceptanceCriteria ?? []).map((ac) => renderAc(ac, ctx)).join('\n');
  return `
<article id="${anchor}" class="doc doc-us">
  <h3>${escapeHtml(us.usId ?? 'US')} - ${escapeHtml(us.title ?? '')}</h3>
  ${broken}
  <p><strong>As a:</strong> ${escapeHtml(us.asA ?? '')}</p>
  <p><strong>I want:</strong> ${escapeHtml(us.iWant ?? '')}</p>
  <p><strong>So that:</strong> ${escapeHtml(us.soThat ?? '')}</p>
  ${fieldPara('Description', us.description)}
  <section class="field-list"><h4>Requirement</h4><p>${docLink(us.reqId)}</p></section>
  <section class="acceptance-criteria">
    <h4>Acceptance criteria</h4>
    ${acBlocks}
  </section>
  ${rawJsonDisclosure(ctx.raw, us)}
</article>`.trim();
}

function renderAc(ac, ctx) {
  const acAnchor = anchorIdFor(ac.id ?? 'AC');
  const fbsList = ctx.fbsByAcId?.get(ac.id) ?? [];
  const fbsLinks = fbsList.length === 0
    ? '<em>not yet delivered by any FBS</em>'
    : fbsList.map((f) => docLink(f.fbsId)).join(', ');
  return `
<section class="ac" id="${acAnchor}">
  <h5>${escapeHtml(ac.id ?? 'AC')}</h5>
  <p>${escapeHtml(ac.description ?? '')}</p>
  ${ac.given ? `<p><strong>Given</strong> ${escapeHtml(ac.given)}</p>` : ''}
  ${ac.when ? `<p><strong>When</strong> ${escapeHtml(ac.when)}</p>` : ''}
  ${ac.then ? `<p><strong>Then</strong> ${escapeHtml(ac.then)}</p>` : ''}
  <p class="ac-meta"><strong>Testable:</strong> ${escapeHtml(String(ac.testable ?? false))} - <strong>Delivered by:</strong> ${fbsLinks}</p>
</section>`.trim();
}
