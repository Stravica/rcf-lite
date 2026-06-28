// REQ renderer. Carries an optional per-REQ Mermaid subdiagram block when
// the caller passes one (the html-page module decides whether to include it).

import {
  anchorIdFor,
  brokenBanner,
  docLink,
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
 * @param {object[]} [ctx.userStories]
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
  const stories = (ctx.userStories ?? []).map((u) => docLink(u.usId, `${u.usId} - ${u.title ?? ''}`));
  const storiesBlock = stories.length === 0
    ? '<p><em>No user stories under this requirement.</em></p>'
    : `<ul>${stories.map((s) => `<li>${s}</li>`).join('')}</ul>`;
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
  <section class="field-list"><h4>User stories</h4>${storiesBlock}</section>
  ${subdiagram}
  ${rawJsonDisclosure(ctx.raw, req)}
</article>`.trim();
}
