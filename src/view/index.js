// View layer entry point. Locates the project root, walks the tree via the
// store, builds the render model and writes index.html + style.css + the
// vendored mermaid.min.js to <projectRoot>/.rcf-view/. Pure-ish: returns the
// list of written files and the exit code the bin should adopt; never calls
// process.exit itself.

import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../store/index.js';
import { renderPage } from './html-page.js';
import { buildTreeModel } from './tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const VENDORED_MERMAID = resolve(here, 'vendored', 'mermaid.min.js');
const STYLE_CSS = resolve(here, 'style.css');

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

async function emptyDir(path) {
  try {
    const entries = await readdir(path);
    await Promise.all(entries.map((e) => rm(join(path, e), { recursive: true, force: true })));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
}

/**
 * Render the view.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to the project root
 * @param {boolean} [args.strict] - refuse to write output on tree errors
 * @param {boolean} [args.verbose] - emit per-document log lines on stdout
 * @param {(line: string) => void} [args.log] - optional stdout sink for verbose lines
 * @returns {Promise<{ written: string[], exitCode: 0 | 1 | 3, errors: import('../errors/index.js').RcfError[] }>}
 */
export async function renderView({ projectRoot, strict = false, verbose = false, log }) {
  const sink = typeof log === 'function' ? log : () => {};

  if (verbose) sink(`[view] walking tree at ${projectRoot}`);
  const { tree, errors } = await walkTree({ projectRoot });

  if (verbose) {
    sink(`[view] loaded ${tree.requirements.length} REQs, ${tree.userStories.length} USs, ${tree.tacs.length} TACs, ${tree.adrs.length} ADRs, ${tree.fbsItems.length} FBSs`);
    if (errors.length > 0) sink(`[view] ${errors.length} tree errors`);
  }

  const hasErrors = errors.length > 0;
  if (hasErrors && strict) {
    return { written: [], exitCode: 3, errors };
  }

  const model = buildTreeModel({ tree, errors });
  const html = renderPage(model);

  const outDir = join(projectRoot, '.rcf-view');
  try {
    await emptyDir(outDir);
    await mkdir(outDir, { recursive: true });
    const indexPath = join(outDir, 'index.html');
    const stylePath = join(outDir, 'style.css');
    const mermaidPath = join(outDir, 'mermaid.min.js');
    await writeFile(indexPath, html, 'utf8');
    await copyFile(STYLE_CSS, stylePath);
    await copyFile(VENDORED_MERMAID, mermaidPath);
    if (verbose) {
      sink(`[view] wrote ${indexPath}`);
      sink(`[view] wrote ${stylePath}`);
      sink(`[view] wrote ${mermaidPath}`);
    }
    const written = [indexPath, stylePath, mermaidPath];
    return { written, exitCode: hasErrors ? 3 : 0, errors };
  } catch (err) {
    return {
      written: [],
      exitCode: 1,
      errors: [
        ...errors,
        {
          kind: 'ioFailure',
          message: `Failed to write view output: ${/** @type {Error} */ (err).message}`,
          filePath: outDir,
        },
      ],
    };
  }
}
