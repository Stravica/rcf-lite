// Design substage writer (ui-design-gate-0.7.0-spec §5, §6.2).
//
// Persistence primitives for the three artefacts (journeys, navModel,
// themeAndA11y) plus the `designStageComplete` boolean. Each verb
// writes via the core store's `updateDocument` path so the writer
// bumps `updatedAt` and schema-validates the FBS document.
//
// Grammar constraint (spec §5.5): the sub-verb parser lives in the CLI
// handler (`src/cli/design.js`); this module accepts already-parsed
// arguments and does not need to defend against string positional
// confusion at this layer.

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';
import { updateDocument } from '@stravica-ai/rcf-lite-core/store';

import { baselineDesignDisagreement } from '../ui-baseline/manifest-writer.js';

/**
 * @typedef {object} DesignJourney
 * @property {string} id
 * @property {string} actor
 * @property {string} goal
 * @property {string[]} steps
 */

/**
 * @typedef {object} DesignNavRoute
 * @property {string} path
 * @property {string} label
 * @property {boolean} authRequired
 */

const NAV_SHAPES = new Set([
  'shared-persistent',
  'shared-per-section',
  'none-single-page',
  'operator-declared-other',
]);
const THEME_MODES = new Set([
  'light-default-with-toggle',
  'dark-default-with-toggle',
  'single-theme-declared',
]);

/**
 * Append a journey to `fbs.designStage.journeys[]`. Writes via
 * `updateDocument`.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} args.tree
 * @param {string} args.fbsId
 * @param {DesignJourney} args.journey
 * @param {string} [args.authoredBy]
 * @param {Date} [args.now]
 */
export async function writeJourneyAdd({ projectRoot, tree, fbsId, journey, authoredBy = 'operator', now = new Date() }) {
  const fbs = tree.byId?.get(fbsId);
  if (!fbs || tree.kindById?.get(fbsId) !== 'fbs') {
    return rcfError({ kind: 'usage', message: `design journeys add: ${fbsId} not found or not an FBS`, documentId: fbsId });
  }
  const validation = validateJourneyShape(journey);
  if (validation) return validation;
  const existing = fbs.designStage?.journeys ?? [];
  if (existing.some((j) => j.id === journey.id)) {
    return rcfError({ kind: 'usage', message: `design journeys add: journey id '${journey.id}' already exists on ${fbsId}`, documentId: fbsId });
  }
  const nextStage = {
    ...(fbs.designStage ?? {}),
    journeys: [...existing, { ...journey }],
    authoredAt: now.toISOString(),
    authoredBy,
  };
  return await updateDocument({
    projectRoot, tree, id: fbsId,
    sets: [{ path: 'designStage', value: nextStage }],
    options: {},
  });
}

/**
 * Overwrite `fbs.designStage.navModel`. Writes via `updateDocument`.
 *
 * @param {object} args
 */
export async function writeNavSet({ projectRoot, tree, fbsId, shape, routes, signedInAsAffordance, notes, authoredBy = 'operator', now = new Date() }) {
  const fbs = tree.byId?.get(fbsId);
  if (!fbs || tree.kindById?.get(fbsId) !== 'fbs') {
    return rcfError({ kind: 'usage', message: `design nav set: ${fbsId} not found or not an FBS`, documentId: fbsId });
  }
  if (!NAV_SHAPES.has(shape)) {
    return rcfError({ kind: 'usage', message: `design nav set: unknown --shape '${shape}' (expected ${[...NAV_SHAPES].join(' | ')})` });
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    return rcfError({ kind: 'usage', message: 'design nav set: at least one --route is required' });
  }
  for (const r of routes) {
    if (!r || typeof r.path !== 'string' || typeof r.label !== 'string' || typeof r.authRequired !== 'boolean') {
      return rcfError({ kind: 'usage', message: `design nav set: bad route '${JSON.stringify(r)}'; expected path=label:authRequired` });
    }
  }
  const navModel = { shape, routes: routes.map((r) => ({ path: r.path, label: r.label, authRequired: r.authRequired })) };
  if (typeof signedInAsAffordance === 'boolean') navModel.signedInAsAffordance = signedInAsAffordance;
  if (typeof notes === 'string' && notes.length > 0) navModel.notes = notes;
  const nextStage = {
    ...(fbs.designStage ?? {}),
    navModel,
    authoredAt: now.toISOString(),
    authoredBy,
  };
  return await updateDocument({
    projectRoot, tree, id: fbsId,
    sets: [{ path: 'designStage', value: nextStage }],
    options: {},
  });
}

/**
 * Overwrite `fbs.designStage.themeAndA11y`. Writes via `updateDocument`.
 *
 * @param {object} args
 */
export async function writeThemeA11ySet({
  projectRoot, tree, fbsId, themeMode, themeTokensModule, contrastTargets,
  contrastTestPath, contrastTestAuthoredBeforePalette, authoredBy = 'operator', now = new Date(),
}) {
  const fbs = tree.byId?.get(fbsId);
  if (!fbs || tree.kindById?.get(fbsId) !== 'fbs') {
    return rcfError({ kind: 'usage', message: `design theme-a11y set: ${fbsId} not found or not an FBS`, documentId: fbsId });
  }
  if (!THEME_MODES.has(themeMode)) {
    return rcfError({ kind: 'usage', message: `design theme-a11y set: unknown --mode '${themeMode}' (expected ${[...THEME_MODES].join(' | ')})` });
  }
  if (typeof themeTokensModule !== 'string' || themeTokensModule.length === 0) {
    return rcfError({ kind: 'usage', message: 'design theme-a11y set: --tokens is required' });
  }
  if (typeof contrastTestPath !== 'string' || contrastTestPath.length === 0) {
    return rcfError({ kind: 'usage', message: 'design theme-a11y set: --contrast-test is required' });
  }
  if (typeof contrastTestAuthoredBeforePalette !== 'boolean') {
    return rcfError({ kind: 'usage', message: 'design theme-a11y set: --contrast-before-palette (true|false) is required' });
  }
  const themeAndA11y = {
    themeMode,
    themeTokensModule,
    contrastTargets: contrastTargets || 'WCAG AA',
    contrastTestPath,
    contrastTestAuthoredBeforePalette,
  };
  const nextStage = {
    ...(fbs.designStage ?? {}),
    themeAndA11y,
    authoredAt: now.toISOString(),
    authoredBy,
  };
  return await updateDocument({
    projectRoot, tree, id: fbsId,
    sets: [{ path: 'designStage', value: nextStage }],
    options: {},
  });
}

/**
 * Set `designStageComplete: true`. Refuses when any of the three
 * artefacts is absent or empty, and when the baseline disagrees with
 * the designStage without an opt-out (spec §6.2 second refusal shape).
 *
 * @param {object} args
 * @returns {Promise<{ ok: true } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function writeMarkComplete({
  projectRoot, tree, fbsId, authoredBy = 'operator', now = new Date(),
}) {
  const fbs = tree.byId?.get(fbsId);
  if (!fbs || tree.kindById?.get(fbsId) !== 'fbs') {
    return rcfError({ kind: 'usage', message: `design --mark-complete: ${fbsId} not found or not an FBS`, documentId: fbsId });
  }
  const missing = missingDesignStageArtefacts(fbs);
  if (missing.length > 0) {
    return rcfError({
      kind: 'usage',
      message: `design --mark-complete: refused - ${fbsId} designStage is missing: ${missing.join(', ')}. `
        + 'Author the missing artefacts first via `rcf design ' + fbsId + ' journeys add ...`, `nav set ...`, or `theme-a11y set ...`.',
      documentId: fbsId,
    });
  }
  const disagreement = firstBaselineDisagreement(tree, fbs);
  if (disagreement) {
    return rcfError({
      kind: 'usage',
      message: `design --mark-complete: refused - ${fbsId} designStage.${disagreement.designStagePath} = ${JSON.stringify(disagreement.designValue)} conflicts with uiBaseline.defaults.${disagreement.path} = ${JSON.stringify(disagreement.baselineValue)} and there is no operatorOptOuts entry. `
        + 'Options: (1) change designStage to match, (2) rcf ui-baseline opt-out --field '
        + disagreement.path + ' --reason "..." (project override), (3) rcf update '
        + fbsId + ' --set designStage.' + disagreement.designStagePath + '=... (per-FBS override).',
      documentId: fbsId,
    });
  }
  const nextStage = {
    ...(fbs.designStage ?? {}),
    authoredAt: now.toISOString(),
    authoredBy,
  };
  const result = await updateDocument({
    projectRoot, tree, id: fbsId,
    sets: [
      { path: 'designStage', value: nextStage },
      { path: 'designStageComplete', value: true },
    ],
    options: {},
  });
  if (result && 'kind' in result && 'message' in result) return result;
  return { ok: true };
}

/**
 * Which of the three required artefacts is missing or empty on the FBS.
 *
 * @param {object} fbs
 * @returns {string[]}
 */
export function missingDesignStageArtefacts(fbs) {
  const missing = [];
  const stage = fbs?.designStage ?? {};
  if (!Array.isArray(stage.journeys) || stage.journeys.length === 0) missing.push('journeys');
  if (!stage.navModel || !Array.isArray(stage.navModel.routes) || stage.navModel.routes.length === 0) missing.push('navModel');
  if (!stage.themeAndA11y || typeof stage.themeAndA11y.themeMode !== 'string') missing.push('themeAndA11y');
  return missing;
}

/**
 * First baseline-vs-designStage disagreement (per spec §6.2). Returns
 * null on agreement or when no baseline / designStage exists.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} fbs
 * @returns {{ path: string, designStagePath: string, baselineValue: *, designValue: * }|null}
 */
export function firstBaselineDisagreement(tree, fbs) {
  const baseline = tree?.manifest?.uiBaseline;
  const stage = fbs?.designStage;
  if (!baseline || !stage) return null;
  // Fields that pair between baseline defaults and designStage.
  const pairs = [
    { defaults: 'themeMode', designStage: 'themeAndA11y.themeMode' },
    { defaults: 'designTokensModule', designStage: 'themeAndA11y.themeTokensModule' },
    { defaults: 'contrastTestBeforePalette', designStage: 'themeAndA11y.contrastTestAuthoredBeforePalette' },
  ];
  for (const p of pairs) {
    const disagreement = baselineDesignDisagreement(baseline, stage, p.defaults, p.designStage);
    if (disagreement) {
      return { ...disagreement, designStagePath: p.designStage };
    }
  }
  return null;
}

function validateJourneyShape(j) {
  if (!j || typeof j !== 'object') return rcfError({ kind: 'usage', message: 'design journeys add: journey object required' });
  if (typeof j.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(j.id)) {
    return rcfError({ kind: 'usage', message: `design journeys add: --id must be a lowercase slug matching /^[a-z][a-z0-9-]*$/, got '${j.id}'` });
  }
  if (typeof j.actor !== 'string' || j.actor.length === 0) return rcfError({ kind: 'usage', message: 'design journeys add: --actor is required' });
  if (typeof j.goal !== 'string' || j.goal.length === 0) return rcfError({ kind: 'usage', message: 'design journeys add: --goal is required' });
  if (!Array.isArray(j.steps) || j.steps.length < 2 || j.steps.length > 8) {
    return rcfError({ kind: 'usage', message: `design journeys add: --step required 2 to 8 times, got ${Array.isArray(j.steps) ? j.steps.length : 0}` });
  }
  for (const s of j.steps) if (typeof s !== 'string' || s.length === 0) {
    return rcfError({ kind: 'usage', message: 'design journeys add: each --step must be a non-empty string' });
  }
  return null;
}
