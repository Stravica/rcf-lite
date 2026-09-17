// Feedback label catalogue (TAC-4105-feedback-render, AC-15902-4). The
// six labels the tool asks GitHub to apply on create, and the same
// six the maintainer bootstrap script creates on a destination repo.
//
// F-6 gate finding: keep the catalogue as a single exported constant
// so the label pre-check on submit, the render.js default-labels
// helper, and the bootstrap script all consume one source of truth.
// A grep test (test/feedback/labels-catalogue.test.js) refuses bare
// literals for these names anywhere else under src/ or scripts/.

/**
 * The six bootstrap labels (ADR-4102). Frozen so a downstream mutation
 * would throw rather than silently drift.
 *
 * @type {readonly [string, string, string, string, string, string]}
 */
export const FEEDBACK_LABELS = Object.freeze([
  'rcf-feedback',
  'severity:blocker',
  'severity:major',
  'severity:minor',
  'area:blueprint',
  'area:core',
]);

/**
 * Machine-readable description of each label (for the bootstrap
 * script's `gh label create` call, which wants a `--description` and
 * a `--color`). Same order as `FEEDBACK_LABELS`.
 */
export const FEEDBACK_LABEL_DEFINITIONS = Object.freeze([
  { name: 'rcf-feedback', description: 'Filed by rcf-lite feedback verb', color: '5319E7' },
  { name: 'severity:blocker', description: 'Blocks a workflow with no workaround', color: 'B60205' },
  { name: 'severity:major', description: 'Significant impact, workaround exists', color: 'D93F0B' },
  { name: 'severity:minor', description: 'Small friction or cosmetic', color: 'FBCA04' },
  { name: 'area:blueprint', description: 'About a blueprint (shelf or library)', color: '0E8A16' },
  { name: 'area:core', description: 'About the rcf-lite core CLI or docs', color: '1D76DB' },
]);

/**
 * The three labels the tool asks for on a given entry (subset of the
 * six above). `severity:<sev>` and `area:<blueprint|core>` are picked
 * per entry; `rcf-feedback` is always requested.
 *
 * Callers pass the severity and the kind; the returned array is the
 * request, before the label pre-check narrows it to what exists on
 * the destination repo.
 *
 * @param {'blocker' | 'major' | 'minor'} severity
 * @param {'blueprint' | 'core'} kind
 * @returns {string[]}
 */
export function labelsForEntry(severity, kind) {
  const out = [FEEDBACK_LABELS[0]];
  const sevLabel = severityLabel(severity);
  if (sevLabel) out.push(sevLabel);
  const areaLabel = areaLabelForKind(kind);
  if (areaLabel) out.push(areaLabel);
  return out;
}

/**
 * `severity:<blocker|major|minor>` from the entry's severity, or null
 * if it is not one of the three (defensive; the enum is fixed).
 *
 * @param {string | undefined | null} severity
 * @returns {string | null}
 */
export function severityLabel(severity) {
  if (severity === 'blocker') return FEEDBACK_LABELS[1];
  if (severity === 'major') return FEEDBACK_LABELS[2];
  if (severity === 'minor') return FEEDBACK_LABELS[3];
  return null;
}

/**
 * `area:blueprint` or `area:core` from the entry's kind, or null on
 * anything else.
 *
 * @param {string | undefined | null} kind
 * @returns {string | null}
 */
export function areaLabelForKind(kind) {
  if (kind === 'blueprint') return FEEDBACK_LABELS[4];
  if (kind === 'core') return FEEDBACK_LABELS[5];
  return null;
}
