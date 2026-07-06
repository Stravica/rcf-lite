// Public surface for the build module (Phase 6 §D8). Pure logic +
// formatters; the CLI handler lives at `src/cli/build.js`.

export { computeQueue, selectNext, byBuildOrder, LIFECYCLE } from './queue.js';
export { assembleBundle } from './bundle.js';
export { planMark } from './mark.js';
export { formatMarkdown } from './formatters/markdown.js';
export { formatJson } from './formatters/json.js';
