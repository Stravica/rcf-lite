// Build-tab renderers (viewer UI refresh PR 5, w-2026-10-02-dave-010
// decisions 2, 3, 6, 12, 14; design doc section 5.6).
//
// This module ships the Build tab's own small pieces:
//   - renderBuildStats(stats): the one-line totals card above the
//     sub-tabstrip. Totals come from the pre-computed BuildStats
//     payload the panel assembles from `computeQueue` (Build Queue is
//     the authoritative source for "buildable now", decision 6 + the
//     brief evidence row).
//   - renderBuildPageHead(bs): the one-line page head carrying the BS
//     id and its generation strategy.
//   - renderSpecBody(fbs, model, buildable): the body shown inside an
//     expanded Spec row - summary, approach, AC and dependency links,
//     deliverables, context links, "Show in the DAG".
//
// The list row chrome (DocRow summary with order / AC / deps / size /
// buildable pill / status) is composed in html-page.js so the row
// renderer stays close to the FilterBar and the sub-tabstrip wiring.
//
// The Test suites section and the FBS slots block are dropped (design
// doc section 3, decision 6); suites stay reachable through AC links
// and the ID lookup once PR 7 ships.

import { escapeHtml, rawJsonDisclosure } from './helpers.js';

/**
 * BuildStats payload shape consumed by renderBuildStats.
 *
 * @typedef {object} BuildStatsPayload
 * @property {number} items
 * @property {number} verified
 * @property {number} complete
 * @property {number} inProgress
 * @property {number} notStarted
 * @property {number} buildableNow     actionable count from computeQueue
 */

/**
 * @param {BuildStatsPayload} stats
 * @returns {string}
 */
export function renderBuildStats(stats) {
  const row = [
    { n: stats.items ?? 0, l: 'build specs' },
    { n: stats.verified ?? 0, l: 'verified' },
    { n: stats.complete ?? 0, l: 'complete' },
    { n: stats.inProgress ?? 0, l: 'in progress' },
    { n: stats.notStarted ?? 0, l: 'not started' },
    { n: stats.buildableNow ?? 0, l: 'buildable now' },
  ];
  const items = stats.items > 0 ? stats.items : 1;
  const pct = (n) => Math.max(0, Math.min(100, Math.round((n / items) * 100)));
  const verifiedPct = pct(stats.verified ?? 0);
  const completePct = pct(stats.complete ?? 0);
  const inProgressPct = pct(stats.inProgress ?? 0);
  const statRow = row.map((s) => (
    `<div class="rcf-build-stat"><span class="rcf-build-stat-n">${escapeHtml(String(s.n))}</span><span class="rcf-build-stat-l">${escapeHtml(s.l)}</span></div>`
  )).join('');
  return `<div class="rcf-build-stats card" role="group" aria-label="Build totals">
  <div class="rcf-build-stats-row">${statRow}</div>
  <div class="rcf-build-progress" aria-hidden="true">
    <span class="rcf-build-progress-seg rcf-build-progress-seg--verified" style="width:${verifiedPct}%"></span>
    <span class="rcf-build-progress-seg rcf-build-progress-seg--complete" style="width:${completePct}%"></span>
    <span class="rcf-build-progress-seg rcf-build-progress-seg--inprogress" style="width:${inProgressPct}%"></span>
  </div>
</div>`;
}

/**
 * @param {object | null | undefined} bs - the Build Sequence doc from the tree
 * @returns {string}
 */
export function renderBuildPageHead(bs) {
  if (!bs) return `<div class="rcf-build-head"></div>`;
  const title = typeof bs.title === 'string' ? bs.title : '';
  const strategy = typeof bs.generationStrategy === 'string' ? bs.generationStrategy : '';
  const parts = [`<span class="rcf-build-head-id mono">${escapeHtml(bs.bsId ?? 'BS')}</span>`];
  const detail = [title, strategy].filter((v) => typeof v === 'string' && v.length > 0).join(' - ');
  if (detail) parts.push(`<span class="muted small">${escapeHtml(detail)}</span>`);
  return `<div class="rcf-build-head">${parts.join('')}</div>`;
}

/**
 * Spec row body: summary, approach, AC and dependency links, deliverables,
 * context links, and the "Show in the DAG" pointer (DAG panel ships in
 * PR 6; the hash target is #tab=build&sub=dag&entity=<id>).
 *
 * @param {object} fbs
 * @param {import('../tree-model.js').BuiltTreeModel} model
 * @param {string} [raw]  raw JSON string for the <details class="raw-json"> disclosure
 * @returns {string}
 */
export function renderSpecBody(fbs, model, raw) {
  const summary = typeof fbs.summary === 'string' && fbs.summary.length > 0
    ? `<p class="rcf-spec-summary">${escapeHtml(fbs.summary)}</p>`
    : '';
  const approach = typeof fbs.approach === 'string' && fbs.approach.length > 0
    ? `<section class="rcf-spec-block"><h4>Approach</h4><p>${escapeHtml(fbs.approach)}</p></section>`
    : '';

  const acIds = Array.isArray(fbs.acIds) ? fbs.acIds : [];
  const acBlock = acIds.length > 0
    ? `<section class="rcf-spec-block"><h4>Acceptance criteria (${acIds.length})</h4><p class="rcf-spec-link-row">${acIds.map((id) => renderAcLink(id)).join(', ')}</p></section>`
    : '';

  const depIds = Array.isArray(fbs.dependsOnFbsIds) ? fbs.dependsOnFbsIds : [];
  const depBlock = depIds.length > 0
    ? `<section class="rcf-spec-block"><h4>Depends on</h4><ul class="rcf-spec-deps">${depIds.map((id) => renderDepLine(id, model)).join('')}</ul></section>`
    : '';

  const deliverables = Array.isArray(fbs.deliverables) ? fbs.deliverables.filter((d) => typeof d === 'string' && d.length > 0) : [];
  const deliverableBlock = deliverables.length > 0
    ? `<section class="rcf-spec-block"><h4>Deliverables</h4><ul class="rcf-spec-deliverables">${deliverables.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul></section>`
    : '';

  const contextBlock = renderContextLinks(fbs.contextRequirements);

  const dagLink = `<p class="rcf-spec-dag"><a href="#tab=build&amp;sub=dag&amp;entity=${escapeHtml(fbs.fbsId ?? '')}">Show in the DAG</a></p>`;

  const rawBlock = rawJsonDisclosure(raw, fbs, fbs.fbsId);

  return `${summary}${approach}${acBlock}${depBlock}${deliverableBlock}${contextBlock}${dagLink}${rawBlock}`;
}

function renderAcLink(id) {
  const esc = escapeHtml(id);
  return `<a class="mono" href="#tab=requirements&amp;entity=${esc}">${esc}</a>`;
}

function renderDepLine(id, model) {
  const esc = escapeHtml(id);
  const dep = model.byId?.get(id);
  const title = typeof dep?.title === 'string' ? dep.title : '';
  const titleFrag = title ? ` <span class="muted">${escapeHtml(title)}</span>` : '';
  return `<li><a class="mono" href="#tab=build&amp;sub=specs&amp;entity=${esc}">${esc}</a>${titleFrag}</li>`;
}

function renderContextLinks(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = [];
  const tacIds = Array.isArray(ctx.tacIds) ? ctx.tacIds : [];
  const adrIds = Array.isArray(ctx.adrIds) ? ctx.adrIds : [];
  const tadSections = Array.isArray(ctx.tadSections) ? ctx.tadSections : [];
  if (tacIds.length === 0 && adrIds.length === 0 && tadSections.length === 0) return '';
  if (tacIds.length > 0) {
    parts.push(`<p class="rcf-spec-link-row"><strong>TACs:</strong> ${tacIds.map((id) => archLink(id)).join(', ')}</p>`);
  }
  if (adrIds.length > 0) {
    parts.push(`<p class="rcf-spec-link-row"><strong>ADRs:</strong> ${adrIds.map((id) => archLink(id)).join(', ')}</p>`);
  }
  if (tadSections.length > 0) {
    parts.push(`<p class="rcf-spec-link-row"><strong>TAD sections:</strong> ${tadSections.map((k) => `<a class="mono" href="#tab=architecture&amp;open=${escapeHtml(k)}">${escapeHtml(k)}</a>`).join(', ')}</p>`);
  }
  return `<section class="rcf-spec-block"><h4>Context</h4>${parts.join('')}</section>`;
}

function archLink(id) {
  const esc = escapeHtml(id);
  return `<a class="mono" href="#tab=architecture&amp;entity=${esc}">${esc}</a>`;
}
