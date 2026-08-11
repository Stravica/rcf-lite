// FBS renderer. Resolves AC ids into their Given/When/Then text rather
// than rendering just the id, so an owner reviewing an FBS section can read
// what each AC requires without jumping back to the User stories area.
// Phase 3.2: `acIds` are also rendered as clickable pills at the top so the
// operator can jump directly across into Requirements-tab context (D8).

import {
  anchorIdFor,
  brokenBanner,
  docLink,
  docLinkList,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} fbs
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('#core/errors').RcfError[]} [ctx.errors]
 * @param {Map<string, object>} [ctx.usByAcId]
 * @returns {string}
 */
export function renderFbs(fbs, ctx) {
  if (!fbs) return '';
  const anchor = anchorIdFor(fbs.fbsId ?? 'FBS');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const acPills = renderAcPills(fbs.acIds ?? []);
  const acBlocks = (fbs.acIds ?? []).map((acId) => renderResolvedAc(acId, ctx)).join('\n');
  const ctxReq = fbs.contextRequirements ?? {};
  const ctxBlocks = renderContextRequirements(ctxReq);
  const designBlock = renderDesignBlock(fbs);
  const designSlot = designBlock ? `\n  ${designBlock}` : '';
  return `
<article id="${anchor}" class="doc doc-fbs">
  <h3>${escapeHtml(fbs.fbsId ?? 'FBS')} - ${escapeHtml(fbs.title ?? '')}</h3>
  ${broken}
  ${fieldPara('Summary', fbs.summary)}
  ${fieldPara('Approach', fbs.approach)}
  ${acPills}
  <section class="field-list"><h4>Acceptance criteria delivered</h4>${acBlocks}</section>
  ${ctxBlocks}${designSlot}
  ${fbs.dependsOnFbsIds?.length ? `<section class="field-list"><h4>Depends on</h4><p>${docLinkList(fbs.dependsOnFbsIds)}</p></section>` : ''}
  ${fieldPara('Estimated size', fbs.estimatedSize)}
  ${fieldPara('Estimated hours', fbs.estimatedHours)}
  ${fieldList('Deliverables', fbs.deliverables)}
  ${fieldPara('Risk level', fbs.riskLevel)}
  ${fieldPara('Build order', fbs.buildOrder)}
  ${fieldPara('Execution status', fbs.executionStatus)}
  ${fieldPara('Notes', fbs.notes)}
  ${rawJsonDisclosure(ctx.raw, fbs, fbs.fbsId)}
</article>`.trim();
}

/**
 * Design substage block (Track B, ui-design-gate-0.7.0-spec §5.5
 * "Honest cost" list: FBS view renderer surfaces designStageComplete +
 * the designStage artefacts). Renders nothing for non-UI FBS.
 *
 * @param {object} fbs
 * @returns {string}
 */
function renderDesignBlock(fbs) {
  if (fbs?.uiBearing !== true && !fbs?.designStage && fbs?.designStageComplete !== true) return '';
  const stage = fbs.designStage ?? {};
  const journeyCount = Array.isArray(stage.journeys) ? stage.journeys.length : 0;
  const navShape = stage.navModel?.shape ?? '(none)';
  const routeCount = Array.isArray(stage.navModel?.routes) ? stage.navModel.routes.length : 0;
  const themeMode = stage.themeAndA11y?.themeMode ?? '(none)';
  const complete = fbs?.designStageComplete === true;
  return `<section class="field-list"><h4>Design substage</h4>
  <p><strong>UI-bearing:</strong> ${escapeHtml(String(fbs?.uiBearing ?? false))}</p>
  <p><strong>Design stage complete:</strong> ${escapeHtml(String(complete))}</p>
  <p><strong>Journeys:</strong> ${escapeHtml(String(journeyCount))}</p>
  <p><strong>Nav model:</strong> ${escapeHtml(String(navShape))} (${escapeHtml(String(routeCount))} route(s))</p>
  <p><strong>Theme and a11y:</strong> ${escapeHtml(String(themeMode))}</p>
</section>`;
}

function renderAcPills(acIds) {
  if (!Array.isArray(acIds) || acIds.length === 0) return '';
  const pills = acIds.map((id) => `<a class="ac-pill" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join('');
  return `<div class="ac-pills">${pills}</div>`;
}

function renderResolvedAc(acId, ctx) {
  const us = ctx.usByAcId?.get(acId);
  const ac = us?.acceptanceCriteria?.find((a) => a.id === acId);
  if (!ac) {
    return `<div class="ac-resolved broken"><p><strong>${escapeHtml(acId)}</strong> (unresolved)</p></div>`;
  }
  return `
<div class="ac-resolved">
  <p><strong>${docLink(acId)}</strong> - ${escapeHtml(ac.description ?? '')}</p>
  ${ac.given ? `<p><em>Given</em> ${escapeHtml(ac.given)}</p>` : ''}
  ${ac.when ? `<p><em>When</em> ${escapeHtml(ac.when)}</p>` : ''}
  ${ac.then ? `<p><em>Then</em> ${escapeHtml(ac.then)}</p>` : ''}
</div>`.trim();
}

function renderContextRequirements(ctx) {
  const parts = [];
  if (Array.isArray(ctx.tadSections) && ctx.tadSections.length > 0) {
    parts.push(`<p><strong>TAD sections:</strong> ${ctx.tadSections.map((s) => escapeHtml(s)).join(', ')}</p>`);
  }
  if (Array.isArray(ctx.tacIds) && ctx.tacIds.length > 0) {
    parts.push(`<p><strong>TACs:</strong> ${docLinkList(ctx.tacIds)}</p>`);
  }
  if (Array.isArray(ctx.adrIds) && ctx.adrIds.length > 0) {
    parts.push(`<p><strong>ADRs:</strong> ${docLinkList(ctx.adrIds)}</p>`);
  }
  if (Array.isArray(ctx.schemas) && ctx.schemas.length > 0) {
    parts.push(`<p><strong>Schemas:</strong> ${ctx.schemas.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}</p>`);
  }
  if (Array.isArray(ctx.externalDocs) && ctx.externalDocs.length > 0) {
    parts.push(`<p><strong>External docs:</strong> ${ctx.externalDocs.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}</p>`);
  }
  if (Array.isArray(ctx.existingModules) && ctx.existingModules.length > 0) {
    parts.push(`<p><strong>Existing modules:</strong> ${ctx.existingModules.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}</p>`);
  }
  if (Array.isArray(ctx.other) && ctx.other.length > 0) {
    parts.push(`<p><strong>Other:</strong> ${ctx.other.map((s) => escapeHtml(s)).join(', ')}</p>`);
  }
  if (parts.length === 0) return '';
  return `<section class="field-list"><h4>Context requirements</h4>${parts.join('\n')}</section>`;
}
