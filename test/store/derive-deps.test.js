// Phase 10 (X2 CodeNode bridge, D5): `--derive-deps` assist unit tests.
// The exec seam is injected so the parsing/mapping logic is fully tested
// without touching the network or requiring dependency-cruiser to be
// installed; one CLI-level test in test/cli/codenode-crud.test.js proves
// the real "not resolvable" helpful-error path against the actual binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveFileDeps, mapDerivedDepsToCnIds, NOT_RESOLVABLE_MESSAGE } from '../../src/store/derive-deps.js';

function fakeCruiserOutput(modules) {
  return { stdout: JSON.stringify({ modules }) };
}

test('deriveFileDeps: not resolvable returns a helpful error, never throws', async () => {
  const exec = async () => { throw new Error('spawn npx ENOENT'); };
  const result = await deriveFileDeps({ projectRoot: '/tmp/whatever', filePath: 'src/a.js', exec });
  assert.equal(result.ok, false);
  assert.equal(result.message, NOT_RESOLVABLE_MESSAGE);
});

test('deriveFileDeps: parses resolved, non-npm, non-core dependencies from dependency-cruiser JSON output', async () => {
  const exec = async () => fakeCruiserOutput([
    {
      source: 'src/a.js',
      dependencies: [
        { resolved: 'src/b.js', dependencyTypes: ['local'] },
        { resolved: 'src/c.js', dependencyTypes: ['local'] },
        { resolved: 'node:fs', dependencyTypes: ['core'] },
        { resolved: 'lodash', dependencyTypes: ['npm'] },
        { resolved: 'src/b.js', dependencyTypes: ['local'] }, // duplicate
      ],
    },
  ]);
  const result = await deriveFileDeps({ projectRoot: '/tmp/whatever', filePath: 'src/a.js', exec });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deps, ['src/b.js', 'src/c.js']);
});

test('deriveFileDeps: unparseable output is a helpful error, not a crash', async () => {
  const exec = async () => ({ stdout: 'not json' });
  const result = await deriveFileDeps({ projectRoot: '/tmp/whatever', filePath: 'src/a.js', exec });
  assert.equal(result.ok, false);
  assert.match(result.message, /unparseable/);
});

test('deriveFileDeps: a module with no matching source entry returns an empty dep list', async () => {
  const exec = async () => fakeCruiserOutput([{ source: 'src/other.js', dependencies: [] }]);
  const result = await deriveFileDeps({ projectRoot: '/tmp/whatever', filePath: 'src/a.js', exec });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deps, []);
});

test('mapDerivedDepsToCnIds: maps file paths to matching CN ids (file or symbol granularity), reports unmatched', () => {
  const tree = {
    codeNodes: [
      { cnId: 'CN-001', path: 'src/b.js#helper' },
      { cnId: 'CN-002', path: 'src/b.js' },
      { cnId: 'CN-003', path: 'src/c.js' },
    ],
  };
  const { cnIds, unmatched } = mapDerivedDepsToCnIds(tree, ['src/b.js', 'src/c.js', 'src/d.js']);
  assert.deepEqual(cnIds, ['CN-001', 'CN-002', 'CN-003']);
  assert.deepEqual(unmatched, ['src/d.js']);
});
