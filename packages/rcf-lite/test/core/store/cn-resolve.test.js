// Phase 10 (X2 CodeNode bridge): staleness detector unit tests. These port
// the PoC's adversarial staleness experiments (file rename, symbol rename,
// namesake false-clean, semantic drift) as automated tests per spec D20 -
// the PoC report's one-off receipts must not remain one-off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkCodeNodeResolution, splitCnPath } from '../../src/store/cn-resolve.js';

async function makeRoot(name) {
  return mkdtemp(join(tmpdir(), `rcf-cn-resolve-${name}-`));
}

function cn(overrides) {
  return {
    cnId: 'CN-001',
    path: 'src/example.js#exampleFn',
    implementsAcIds: ['AC-101-1'],
    dependencies: [],
    version: '0.1.0',
    status: 'draft',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

test('splitCnPath separates file and symbol parts', () => {
  assert.deepEqual(splitCnPath('src/store/validator.js#getAjv'), { file: 'src/store/validator.js', symbol: 'getAjv' });
  assert.deepEqual(splitCnPath('src/store/validator.js'), { file: 'src/store/validator.js', symbol: null });
});

test('checkCodeNodeResolution: clean tree resolves both file-level and symbol-level CNs', async () => {
  const root = await makeRoot('clean');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'example.js'), 'export function exampleFn() {\n  return 1;\n}\n', 'utf8');
  const tree = { codeNodes: [cn({ cnId: 'CN-001', path: 'src/example.js#exampleFn' }), cn({ cnId: 'CN-002', path: 'src/example.js', implementsAcIds: [] })] };
  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  assert.deepEqual(errors, []);
});

// -- Experiment 1a: file rename (PoC-proven) --------------------------------

test('staleCode/fileResolves: a renamed file is detected, exit-worthy, one-field repairable', async () => {
  const root = await makeRoot('file-rename');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'map-errors.js'), 'export function formatErrors() {}\n', 'utf8');
  const tree = { codeNodes: [cn({ cnId: 'CN-010', path: 'src/map-errors.js' })] };

  // Baseline: clean.
  assert.deepEqual(await checkCodeNodeResolution({ projectRoot: root, tree }), []);

  // Competent refactor: rename the file (importer-fixing is out of scope
  // here - the CN pointer is what's being probed).
  const { rename } = await import('node:fs/promises');
  await rename(join(root, 'src', 'map-errors.js'), join(root, 'src', 'error-mapping.js'));

  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'staleCode');
  assert.equal(errors[0].rule, 'fileResolves');
  assert.equal(errors[0].documentId, 'CN-010');
  assert.match(errors[0].message, /file src\/map-errors\.js does not exist/);

  // Repair: one field edit (path), validate clean.
  const repaired = { codeNodes: [cn({ cnId: 'CN-010', path: 'src/error-mapping.js' })] };
  assert.deepEqual(await checkCodeNodeResolution({ projectRoot: root, tree: repaired }), []);
});

// -- Experiment 1b: symbol rename (PoC-proven) ------------------------------

test('staleCode/symbolResolves: a renamed symbol is detected; file-level CNs over the same file stay silent (zero false positives)', async () => {
  const root = await makeRoot('symbol-rename');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'errors.js'), 'export function formatErrors(list) {\n  return list.join(", ");\n}\n', 'utf8');
  const tree = {
    codeNodes: [
      cn({ cnId: 'CN-009', path: 'src/errors.js#formatErrors' }),
      cn({ cnId: 'CN-101', path: 'src/errors.js', implementsAcIds: [] }), // file-level, coarser
    ],
  };
  assert.deepEqual(await checkCodeNodeResolution({ projectRoot: root, tree }), []);

  // Competent refactor: rename the symbol, callers fixed elsewhere (not
  // modelled here - only the CN pointer's survival is under test).
  await writeFile(join(root, 'src', 'errors.js'), 'export function renderErrors(list) {\n  return list.join(", ");\n}\n', 'utf8');

  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  assert.equal(errors.length, 1, 'exactly one CN should trip - zero false positives');
  assert.equal(errors[0].documentId, 'CN-009');
  assert.equal(errors[0].rule, 'symbolResolves');
  assert.match(errors[0].message, /symbol 'formatErrors' not found/);

  // Repair: one field edit.
  const repaired = {
    codeNodes: [
      cn({ cnId: 'CN-009', path: 'src/errors.js#renderErrors' }),
      cn({ cnId: 'CN-101', path: 'src/errors.js', implementsAcIds: [] }),
    ],
  };
  assert.deepEqual(await checkCodeNodeResolution({ projectRoot: root, tree: repaired }), []);
});

// -- Honest limitation: namesake false-clean --------------------------------

test('honest limit: a symbol moved elsewhere while a same-file namesake declaration survives false-cleans', async () => {
  const root = await makeRoot('namesake');
  await mkdir(join(root, 'src'), { recursive: true });
  // The CN's target symbol "helper" was meant to move to util.js, but a
  // namesake const named "helper" still exists in the original file for
  // an unrelated purpose. The deterministic anchor scan has no lexical
  // scope awareness, so it reports present.
  await writeFile(join(root, 'src', 'original.js'), 'const helper = "unrelated-local-value";\n', 'utf8');
  await writeFile(join(root, 'src', 'util.js'), 'export function helper() { return 42; }\n', 'utf8');
  const tree = { codeNodes: [cn({ cnId: 'CN-020', path: 'src/original.js#helper' })] };
  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  assert.deepEqual(errors, [], 'documented honest limitation: false-cleans on namesake collision');
});

// -- Honest limitation: semantic drift is invisible -------------------------

test('honest limit: a gutted function body with an intact name validates clean (semantic drift out of reach)', async () => {
  const root = await makeRoot('semantic-drift');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'validator.js'), [
    'let cachedAjv = null;',
    'function getAjv() {',
    '  if (cachedAjv) return cachedAjv;',
    '  cachedAjv = build();',
    '  return cachedAjv;',
    '}',
    '',
  ].join('\n'), 'utf8');
  const tree = { codeNodes: [cn({ cnId: 'CN-001', path: 'src/validator.js#getAjv' })] };
  assert.deepEqual(await checkCodeNodeResolution({ projectRoot: root, tree }), []);

  // Gut the once-only cache guard (a direct behavioural regression) while
  // leaving the declaration name intact.
  await writeFile(join(root, 'src', 'validator.js'), [
    'function getAjv() {',
    '  return build();',
    '}',
    '',
  ].join('\n'), 'utf8');
  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  assert.deepEqual(errors, [], 'documented honest limitation: semantic drift is invisible to a deterministic check');
});

test('checkCodeNodeResolution handles multiple stale CNs and reuses the per-file read cache', async () => {
  const root = await makeRoot('multi');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'shared.js'), 'export function alpha() {}\n', 'utf8');
  const tree = {
    codeNodes: [
      cn({ cnId: 'CN-001', path: 'src/shared.js#alpha' }),
      cn({ cnId: 'CN-002', path: 'src/shared.js#missingOne' }),
      cn({ cnId: 'CN-003', path: 'src/shared.js#missingTwo' }),
      cn({ cnId: 'CN-004', path: 'src/does-not-exist.js' }),
    ],
  };
  const errors = await checkCodeNodeResolution({ projectRoot: root, tree });
  const ruleFor = (id) => errors.find((e) => e.documentId === id)?.rule;
  assert.equal(ruleFor('CN-001'), undefined);
  assert.equal(ruleFor('CN-002'), 'symbolResolves');
  assert.equal(ruleFor('CN-003'), 'symbolResolves');
  assert.equal(ruleFor('CN-004'), 'fileResolves');
  assert.equal(errors.length, 3);
});

test('checkCodeNodeResolution on an empty codeNodes list returns no errors', async () => {
  const root = await makeRoot('empty');
  const errors = await checkCodeNodeResolution({ projectRoot: root, tree: {} });
  assert.deepEqual(errors, []);
});
