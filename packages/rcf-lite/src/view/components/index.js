// Shared component barrel (viewer UI refresh PR 2). Re-exports every
// per-component string helper so downstream tabs can import a single
// well-known path. New components added in later PRs land here too.

export { pill } from './pill.js';
export { renderDocRow } from './doc-row.js';
export { renderBadge } from './badge.js';
export { renderFilterBar } from './filter-bar.js';
export { renderEmptyState } from './empty-state.js';
export { renderToastContainer } from './toast.js';
export { renderSubTabStrip } from './sub-tab-strip.js';
