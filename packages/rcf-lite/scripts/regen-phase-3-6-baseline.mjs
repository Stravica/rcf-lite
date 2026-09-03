// Regenerate test/view/fixtures/phase-3-6-static.html by running the exact
// buildTreeModel + renderPage pipeline the layout-regression test uses, then
// normalising via the same stripKnownDeltas() function. Run only when the
// dogfood rcf/ tree grew (e.g. new TS files landed) and the layout-regression
// test trips on additive content. Node 24 built-ins only.

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../src/view/html-page.js';
import { buildTreeModel } from '../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturePath = resolve(repoRoot, 'test', 'view', 'fixtures', 'phase-3-6-static.html');

function stripKnownDeltas(html) {
  let out = html;
  out = out.replace(/\n    <div id="rcf-live-content">\n    /, '\n    ');
  out = out.replace(/\n    <\/div>\n  <\/main>/, '\n  </main>');
  out = out.replace(/\s*<script src="\/live-client\.js" defer><\/script>/, '');
  out = out.replace(/<details class="raw-json" data-doc-id="[^"]+"/g, '<details class="raw-json"');
  out = out.replace(
    /Read-only; changes on disk stream to this tab automatically\./,
    'Read-only; regenerate with <code>rcf-view</code> to see fresh state.',
  );
  return out;
}

const result = await walkTree({ projectRoot: repoRoot });
const model = buildTreeModel(result);
const rendered = renderPage(model);
const normalised = stripKnownDeltas(rendered);
await writeFile(fixturePath, normalised, 'utf8');
process.stdout.write(`wrote ${fixturePath} (${normalised.length} bytes)\n`);
