// REQ renderer. FBS-208 (AC-209-5): the per-REQ Mermaid slice is retired on
// the user-facing surface; this renderer no longer emits a slice block even
// when a caller still passes `ctx.subdiagram`. Child user stories are NOT
// rendered as inline links because the Phase 3.2 layout nests them as
// `<details>` under the REQ's own `<details>` wrapper.

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
 * @param {import('#core/errors').RcfError[]} [ctx.errors]
 * @param {string|undefined} [ctx.subdiagram] - accepted for back-compat;
 *   FBS-208 retires rendering of the per-REQ Mermaid slice, so this value
 *   is ignored.
 * @param {string|undefined} [ctx.idPrefix] - prefix prepended to every emitted
 *   id/anchor so the same REQ can be rendered under multiple Product Map
 *   buckets without duplicating ids. Empty when rendered from the
 *   Requirements tab so its anchors stay canonical.
 * @param {boolean} [ctx.suppressRawJson] - when true, the raw-JSON disclosure
 *   is not emitted (Product Map compact cards; the disclosure stays on
 *   the Requirements tab). AC-17007-1 payload weight.
 * @returns {string}
 */
export function renderReq(req, ctx) {
  if (!req) return '';
  const prefix = ctx.idPrefix ?? '';
  const anchor = `${prefix}${anchorIdFor(req.reqId ?? 'REQ')}`;
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  // FBS-208 (AC-209-5): the Mermaid slice block is not emitted even when
  // `ctx.subdiagram` is passed. The ctx key stays accepted so Product Map
  // callers continue to compile.
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
  ${ctx.suppressRawJson ? '' : rawJsonDisclosure(ctx.raw, req, req.reqId, prefix)}
</article>`.trim();
}
