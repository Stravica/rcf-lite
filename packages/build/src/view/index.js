// View layer entry point. Locates the project root, walks the tree via the
// store, builds the render model and hands the server the pre-rendered
// HTML strings. Phase 3.8 removed the disk-write path (`.rcf-view/`
// convention retired wholesale); the view surface is now server-only.
// See specs/phase-3.8-live-view.md D9 for the CLI rewrite rationale.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

import { walkTree } from '../store/index.js';
import { renderContent, renderPage } from './html-page.js';
import { buildTreeModel } from './tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
export const VENDORED_MERMAID_PATH = resolve(here, 'vendored', 'mermaid.min.js');
export const STYLE_CSS_PATH = resolve(here, 'style.css');
export const LIVE_CLIENT_PATH = resolve(here, 'live-client.js');

/**
 * Walk up from `start` looking for an ancestor directory containing a
 * `rcf/manifest.json`. Returns the absolute directory path or null.
 *
 * @param {string} start - absolute directory to start from
 * @returns {Promise<string | null>}
 */
export async function findProjectRoot(start) {
  let dir = resolve(start);
  while (true) {
    try {
      const candidate = join(dir, 'rcf', 'manifest.json');
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(candidate);
      if (s.isFile()) return dir;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Walk the tree at `projectRoot`, build the render model and render both
 * the full HTML page and the innerHTML of the swappable content wrapper.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to the project root
 * @returns {Promise<{
 *   fullPageHtml: string,
 *   contentHtml: string,
 *   errors: import('../errors/index.js').RcfError[],
 *   tree: import('../store/walker.js').Tree,
 * }>}
 */
export async function renderModelToPage({ projectRoot }) {
  const { tree, errors } = await walkTree({ projectRoot });
  const model = buildTreeModel({ tree, errors });
  const fullPageHtml = renderPage(model);
  const contentHtml = renderContent(model);
  return { fullPageHtml, contentHtml, errors, tree };
}
