// Readiness StageLegend (viewer UI refresh PR 8, decision 16).
//
// Renders a `<dialog>` listing D1..D8 by name, one-line meaning and
// posture (blocks the freeze, or warns until acknowledged). Opens
// from any D-chip or D-prefixed check name; client wiring lives in
// page-init.js (`wireStageLegend`). The dialog is server-rendered
// HTML so the shell carries no inline script.

import { escapeHtml } from '../doc-renderers/helpers.js';
import { STAGE_GATES, STAGE_ORDER } from '../../query/gates.js';

/**
 * Human-readable name and one-line meaning per stage, aligned with
 * design doc section 4 and the readiness wireframe (STAGE_GATES).
 *
 * @type {Record<string, { name: string, meaning: string, posture: 'blocking'|'warn-with-ack' }>}
 */
export const STAGE_LEGEND = {
  D1: { name: 'Brief', meaning: 'Brief intake and ledger: the owner\'s statements numbered and kinded, open questions answered or promoted, profile markers set.', posture: 'blocking' },
  D2: { name: 'Skeleton', meaning: 'Requirements and architecture skeleton: every statement resolves to a requirement, an entity, an actor, a system or a surface; TAD persistence and a deploy decision exist.', posture: 'blocking' },
  D3: { name: 'Shapes', meaning: 'Interface contracts and shapes on components and on shaped requirements (http, persistence, auth).', posture: 'warn-with-ack' },
  D4: { name: 'Stories', meaning: 'Stories and criteria floors: every requirement has a story; stories carry failure and must-not criteria.', posture: 'blocking' },
  D5: { name: 'Crosscut', meaning: 'Cross-cutting weave: security, operations and the other concerns are present where the requirements imply them.', posture: 'warn-with-ack' },
  D6: { name: 'Consistency', meaning: 'Consistency and satisfiability probe: the tree validates clean and no probe is left open.', posture: 'warn-with-ack' },
  D7: { name: 'Decisions', meaning: 'Decisions and review: every decision enumerated with options and a default; none open at freeze.', posture: 'blocking' },
  D8: { name: 'Freeze', meaning: 'Freeze: prior stages passed or acknowledged, every criterion owned by one build spec, the queue head actionable, validate clean.', posture: 'blocking' },
};

/**
 * Short title for a stage, used as the `title` attribute on D-chips
 * and D-prefixed check names (hover-to-explain).
 *
 * @param {string} stage
 * @returns {string}
 */
export function stageTitle(stage) {
  const row = STAGE_LEGEND[stage];
  if (!row) return stage;
  return `${stage} ${row.name}: ${row.meaning.split(':')[0]}`;
}

/**
 * Render the StageLegend `<dialog>` HTML.
 *
 * @returns {string}
 */
export function renderStageLegend() {
  const rows = STAGE_ORDER.map((stage) => {
    const row = STAGE_LEGEND[stage];
    const gate = STAGE_GATES[stage];
    const postureClass = row.posture === 'blocking' ? 'fail' : 'warn';
    const postureLabel = row.posture === 'blocking' ? 'blocks freeze' : 'warns, acknowledge to pass';
    return `<tr data-stage="${escapeHtml(stage)}">`
      + `<td class="rcf-stage-legend__code"><code>${escapeHtml(stage)}</code></td>`
      + `<td class="rcf-stage-legend__name"><strong>${escapeHtml(row.name)}</strong> <span class="muted"><code>${escapeHtml(gate)}</code></span></td>`
      + `<td class="rcf-stage-legend__meaning">${escapeHtml(row.meaning)}</td>`
      + `<td class="rcf-stage-legend__posture"><span class="rcf-pill rcf-pill--${postureClass}">${escapeHtml(postureLabel)}</span></td>`
      + `</tr>`;
  }).join('');
  return `<dialog id="rcf-stage-legend" class="rcf-stage-legend" aria-labelledby="rcf-stage-legend-title">
  <header class="rcf-stage-legend__head">
    <h2 id="rcf-stage-legend-title">Stage guide: D1 to D8</h2>
    <form method="dialog"><button type="submit" class="rcf-stage-legend__close">Close</button></form>
  </header>
  <p class="rcf-stage-legend__intro muted">The eight DEFINE stages the readiness object reports on. A blocking stage must pass before the tree can freeze; a warning stage passes once its findings are acknowledged. Codes are the chain's names; the viewer never asks a product owner to read them.</p>
  <table class="rcf-stage-legend__table">
    <thead><tr><th>Stage</th><th>Name</th><th>What it checks</th><th>Posture</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</dialog>`;
}
