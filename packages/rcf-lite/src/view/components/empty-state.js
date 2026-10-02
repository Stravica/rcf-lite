// Shared EmptyState (viewer UI refresh PR 2, design doc section 4):
// one dashed-outline, muted-text block for "nothing here yet" cases
// across every tab (Architecture section without content, a Needs-work
// table with no rows, a filter that excludes every item, etc).
//
// Shape:
//   <div class="rcf-empty-state empty" role="status">
//     <p class="rcf-empty-state-title">{title}</p>
//     [<p class="rcf-empty-state-hint">{hint}</p>]
//     [<p class="rcf-empty-state-action">{actionHtml}</p>]
//   </div>
//
// `hint` is plain text; `actionHtml` is an escape hatch for the one
// case the design calls out (an authoring CLI call under a missing TAD
// section) and must already be safe HTML - callers that pass raw user
// text should use `hint` instead.

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.hint]
 * @param {string} [args.actionHtml]
 * @returns {string}
 */
export function renderEmptyState({ title, hint, actionHtml }) {
  const hintBlock = hint ? `<p class="rcf-empty-state-hint">${escapeHtml(hint)}</p>` : '';
  const actionBlock = actionHtml ? `<p class="rcf-empty-state-action">${actionHtml}</p>` : '';
  return `<div class="rcf-empty-state empty" role="status">
    <p class="rcf-empty-state-title">${escapeHtml(title)}</p>
    ${hintBlock}
    ${actionBlock}
  </div>`;
}
