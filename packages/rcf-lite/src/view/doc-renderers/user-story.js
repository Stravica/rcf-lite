// User story renderer. ACs are rendered inline as list items so an AC can
// be a top-level scroll anchor (per Phase 3.2 D4) without wrapping each in
// its own `<section>`. Each AC line links back to the FBS or FBSs that
// deliver it via `fbsByAcId` (D8).

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
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} [ctx.errors]
 * @param {Map<string, object[]>} [ctx.fbsByAcId]
 * @returns {string}
 */
export function renderUserStory(us, ctx) {
  if (!us) return '';
  const anchor = anchorIdFor(us.usId ?? 'US');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const acItems = (us.acceptanceCriteria ?? []).map((ac) => renderAcItem(ac, ctx)).join('\n');
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
    <ul class="ac-list">
      ${acItems}
    </ul>
  </section>
  ${rawJsonDisclosure(ctx.raw, us, us.usId)}
</article>`.trim();
}

function renderAcItem(ac, ctx) {
  const acId = ac.id ?? 'AC';
  const acAnchor = anchorIdFor(acId);
  const fbsList = ctx.fbsByAcId?.get(acId) ?? [];
  const coveredBy = fbsList.length === 0
    ? '<em>not yet delivered by any FBS</em>'
    : `Covered by ${fbsList.map((f) => docLink(f.fbsId)).join(', ')}`;
  const parts = [];
  parts.push(`<strong>${escapeHtml(acId)}</strong> - ${escapeHtml(ac.description ?? '')}`);
  const gwt = [];
  if (ac.given) gwt.push(`<em>Given</em> ${escapeHtml(ac.given)}`);
  if (ac.when) gwt.push(`<em>When</em> ${escapeHtml(ac.when)}`);
  if (ac.then) gwt.push(`<em>Then</em> ${escapeHtml(ac.then)}`);
  if (gwt.length > 0) parts.push(`<div class="ac-gwt">${gwt.map((p) => `<p>${p}</p>`).join('')}</div>`);
  parts.push(`<p class="ac-meta"><strong>Testable:</strong> ${escapeHtml(String(ac.testable ?? false))} - ${coveredBy}</p>`);
  return `<li id="${acAnchor}" class="ac-item">${parts.join('\n')}</li>`;
}
