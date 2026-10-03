// View layer entry point. Locates the project root, walks the tree via the
// store, builds the render model and hands the server the pre-rendered
// HTML strings. Phase 3.8 removed the disk-write path (`.rcf-view/`
// convention retired wholesale); the view surface is now server-only.
// See specs/phase-3.8-live-view.md D9 for the CLI rewrite rationale.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

import { resolveTestPointers, walkTree } from '#core/store';
import { computeReadiness } from '../query/readiness.js';
import { computeQuestions } from '../query/questions.js';
import { loadFreezeRecord } from '../define/freeze-record.js';
import { loadAllLedgers } from '../define/ledgers.js';
import { renderContent, renderPage } from './html-page.js';
import { renderProductMapGrouping } from './product-map.js';
import { buildTreeModel } from './tree-model.js';
import { serialiseViewIndex } from './view-index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const VENDORED_MERMAID_PATH = resolve(here, 'vendored', 'mermaid.min.js');
export const STYLE_CSS_PATH = resolve(here, 'style.css');
export const LIVE_CLIENT_PATH = resolve(here, 'live-client.js');
// Viewer UI refresh PR 1 (Dex / wespa 2026-10-02 #263): the former
// inline <script> block from html-page.js now lives at this path and
// is served over the new /page-init.js route. Release notes name it so
// wespa's proxy allow-list is extended before any version pin bump.
export const PAGE_INIT_PATH = resolve(here, 'page-init.js');

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
 *   errors: import('#core/errors').RcfError[],
 *   tree: import('#core/store/walker.js').Tree,
 * }>}
 */
export async function renderModelToPage({ projectRoot }) {
  const { tree, errors } = await walkTree({ projectRoot });

  // Load the readiness inputs once per rewalk; the viewer is pure
  // (never recomputes readiness). Failures load as `null` so the tab
  // still renders when a tree is partial.
  const [freezeRecord, ledgers, testPointers, profileText] = await Promise.all([
    loadFreezeRecord({ projectRoot }).catch(() => null),
    loadAllLedgers({ projectRoot }).catch(() => ({})),
    resolveTestPointers({ projectRoot, tree }).catch(() => undefined),
    readProfileText(projectRoot),
  ]);

  let readiness = null;
  try {
    readiness = computeReadiness(tree, {
      freeze: freezeRecord,
      ledgers,
      profile: undefined,
      profileText,
      testPointers,
      validateErrors: errors,
    });
  } catch (err) {
    // A malformed tree should not block the viewer; the Readiness tab
    // renders its "could not be computed" placeholder in that case.
    readiness = null;
  }

  // Viewer UI refresh PR 8 (TAC-4133, ADR-4135, AC-18002-1): fold the
  // DEFINE step 3 PR 2 `computeQuestions` output onto the readiness
  // object before the view reads it, so the PO layer's question
  // adapter feature-detects the real shape (`questions[]`, `groups[]`,
  // `optional[]`, `engineer.blockers`) rather than falling back to the
  // blockers path. Pure fold; `computeQuestions` is a composer over
  // the same readiness object and writes nothing under rcf/.
  if (readiness) {
    try {
      const q = computeQuestions(readiness, {
        tree,
        ledgers,
        profileText,
        persona: 'productOwner',
      });
      readiness.questions = q.questions;
      readiness.questionGroups = q.groups;
      readiness.questionOptional = q.optional;
      readiness.questionEngineer = q.engineer ?? null;
    } catch {
      // Composition failure never blocks the viewer; the adapter falls
      // back to the blockers path when `readiness.questions` is absent.
    }
  }

  const model = buildTreeModel({ tree, errors });
  model.readiness = readiness;
  model.profileText = profileText;
  model.freezeRecord = freezeRecord;
  const fullPageHtml = renderPage(model);
  const contentHtml = renderContent(model);
  // Pre-rendered partials for the /product-map/<group> endpoint
  // (AC-17007-1). The full page ships only the shape grouping's REQ
  // cards; the client fetches the other three on demand from these
  // strings. Regenerated on every rewalk so the cache stays consistent
  // with the tree on disk.
  const pmPartials = {
    shape: renderProductMapGrouping(model, 'shape'),
    component: renderProductMapGrouping(model, 'component'),
    trace: renderProductMapGrouping(model, 'trace'),
    capability: renderProductMapGrouping(model, 'capability'),
    blueprint: renderProductMapGrouping(model, 'blueprint'),
  };
  // Viewer UI refresh PR 7 (TAC-4132, ADR-4134): the ID lookup index
  // is built on every rewalk from BuiltTreeModel and served from the
  // new `./index.json` route (release-noted so wespa's proxy allow-
  // list is extended before the version pin bump). One row per doc id
  // plus one row per AC under each US.
  const indexJson = serialiseViewIndex(model);
  return { fullPageHtml, contentHtml, errors, tree, pmPartials, indexJson };
}

/**
 * Read `rcf/.identity/profile.md` text or return null when the file
 * is absent (the Readiness tab orders persona groups as PO-first in
 * the absent case).
 *
 * @param {string} projectRoot
 * @returns {Promise<string | null>}
 */
async function readProfileText(projectRoot) {
  try {
    return await readFile(join(projectRoot, 'rcf', '.identity', 'profile.md'), 'utf8');
  } catch (err) {
    return null;
  }
}
