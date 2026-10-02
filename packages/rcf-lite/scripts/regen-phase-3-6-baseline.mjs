// Regenerate test/view/fixtures/phase-3-6-static.html by running the exact
// buildTreeModel + renderPage pipeline the layout-regression test uses.
// The viewer UI refresh (PR 1 onward) retired the Phase-3.8 strip-and-
// compare helper, so this script now writes the pipeline output verbatim
// and the layout-regression test does a byte-for-byte compare. Run only
// after a conscious shell / layout change.

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../src/view/html-page.js';
import { buildTreeModel } from '../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturePath = resolve(repoRoot, 'test', 'view', 'fixtures', 'phase-3-6-static.html');

const result = await walkTree({ projectRoot: repoRoot });
const model = buildTreeModel(result);
const rendered = renderPage(model);
await writeFile(fixturePath, rendered, 'utf8');
process.stdout.write(`wrote ${fixturePath} (${rendered.length} bytes)\n`);
