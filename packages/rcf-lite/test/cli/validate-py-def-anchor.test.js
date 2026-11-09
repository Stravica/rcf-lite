// FBS-244 (US-19905): a Code Node #symbol on a Python def resolves at
// rcf define validate. Criterion: AC-19905-4, external. The test drives
// bin/rcf.js define validate --json as a child process over a project
// the bin's own rcf init makes, holding src/mod.py and two Code Node
// records written into the copy: src/mod.py#canonical (the def) and
// src/mod.py#Settings (a Python class X, the control). src/mod.py is
// written twice: canonical as a top-level def, then as an async def
// indented inside the class; no other line of either names canonical
// at its start. Red at the round's DEFINE head: no declaration anchor
// matches "def canonical(", so validate reports staleCode
// symbolResolves on CN-001 while the def is there. Imports: Node
// builtins and test/_harness/ only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rcf } from '../_harness/spawn.js';
import { project, writeJson, writeText } from '../_harness/fixture.js';
import { json } from '../_harness/capture.js';

const L = (...ls) => `${ls.join('\n')}\n`;
// canonical as a top-level def, after the class.
const TOP = (name) => L(
  '"""A module for the def anchor: a class, then a top-level def."""',
  '',
  '',
  'class Settings:',
  '    """A Python class X: the control, resolving before and after."""',
  '',
  '    title = "settings"',
  '',
  '',
  `def ${name}(path):`,
  '    return "/" + "/".join(part for part in path.split("/") if part)',
);
// canonical as an async def, indented inside the class.
const NESTED = (name) => L(
  '"""A module for the def anchor: an async def indented inside a class."""',
  '',
  '',
  'class Settings:',
  '    """A Python class X: the control, resolving before and after."""',
  '',
  `    async def ${name}(self, path):`,
  '        return path.strip("/")',
);

function codeNode(dir, n, path) {
  const id = `CN-${String(n).padStart(3, '0')}`;
  writeJson(dir, `rcf/code-nodes/${id.toLowerCase()}.json`, {
    cnId: id, path, title: `fixture node ${path}`, description: `Fixture Code Node on ${path}.`,
    implementsAcIds: ['AC-101-1'], dependencies: [], version: '0.1.0', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
}

const validate = (dir) => rcf(['define', 'validate', '--json'], { cwd: dir });
const shown = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const stale = (r) => (json(r.stdout).issues ?? []).filter((i) => i.kind === 'staleCode').map((i) => `${i.id} ${i.rule}`);

test('AC-19905-4: a Code Node src/mod.py#canonical resolves at rcf define validate where src/mod.py declares def canonical( at the top level or async def canonical( indented in a class (exit 0, no staleCode); after the def is renamed validate exits 3 with staleCode rule symbolResolves on that Code Node alone; the Code Node src/mod.py#Settings on a Python class keeps resolving', async (t) => {
  const dir = await project(t, { name: 'pydef' });
  codeNode(dir, 1, 'src/mod.py#canonical');
  codeNode(dir, 2, 'src/mod.py#Settings');

  for (const [shape, text] of [['a top-level def', TOP], ['an async def indented in a class', NESTED]]) {
    writeText(dir, 'src/mod.py', text('canonical'));
    const ok = await validate(dir);
    assert.deepEqual(stale(ok), [], `${shape}: no staleCode for src/mod.py#canonical or src/mod.py#Settings\n${shown(ok)}`);
    assert.equal(ok.code, 0, `${shape}: validate exits 0\n${shown(ok)}`);

    writeText(dir, 'src/mod.py', text('canonical_path'));
    const renamed = await validate(dir);
    assert.equal(renamed.code, 3, `${shape} renamed: validate exits 3\n${shown(renamed)}`);
    assert.deepEqual(stale(renamed), ['CN-001 symbolResolves'], `${shape} renamed: staleCode symbolResolves on CN-001 alone; the class control keeps resolving\n${shown(renamed)}`);
  }
});
