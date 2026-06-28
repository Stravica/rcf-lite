import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDocument, loadRootDocument, pathForId, rootPathFor, subdirFor } from '../../src/store/loader.js';

async function makeFixtureRoot(name) {
  const root = await mkdtemp(join(tmpdir(), `rcf-loader-${name}-`));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await mkdir(join(root, 'rcf', 'requirements'), { recursive: true });
  return root;
}

test('pathForId resolves canonical ids', () => {
  assert.deepEqual(pathForId('REQ-002'), { kind: 'req', relPath: 'requirements/req-002.json' });
  assert.deepEqual(pathForId('US-201'), { kind: 'userStory', relPath: 'user-stories/us-201.json' });
  assert.deepEqual(pathForId('TAC-007'), { kind: 'tac', relPath: 'tacs/tac-007.json' });
  assert.deepEqual(pathForId('ADR-001'), { kind: 'adr', relPath: 'adrs/adr-001.json' });
  assert.deepEqual(pathForId('FBS-003'), { kind: 'fbs', relPath: 'fbs/fbs-003.json' });
  assert.deepEqual(pathForId('PRD-001'), { kind: 'prd', relPath: 'prd.json' });
  assert.deepEqual(pathForId('TAD-001'), { kind: 'tad', relPath: 'tad.json' });
  assert.deepEqual(pathForId('BS-001'), { kind: 'buildSequence', relPath: 'build-sequence.json' });
});

test('pathForId returns null for unknown id shapes', () => {
  assert.equal(pathForId('XYZ-001'), null);
  assert.equal(pathForId(''), null);
  assert.equal(pathForId(null), null);
});

test('subdirFor maps kinds to layout dirs', () => {
  assert.equal(subdirFor('req'), 'requirements');
  assert.equal(subdirFor('userStory'), 'user-stories');
  assert.equal(subdirFor('fbs'), 'fbs');
  assert.equal(subdirFor('prd'), null);
});

test('rootPathFor returns the manifest path', () => {
  assert.equal(rootPathFor('manifest'), 'manifest.json');
  assert.equal(rootPathFor('prd'), 'prd.json');
});

test('rootPathFor rejects non-root kinds', () => {
  assert.throws(() => rootPathFor('req'), TypeError);
});

test('loadDocument returns missingFile for absent file', async () => {
  const root = await makeFixtureRoot('missing');
  const result = await loadDocument({ projectRoot: root, id: 'REQ-001' });
  assert.equal(result.kind, 'missingFile');
  assert.equal(result.documentId, 'REQ-001');
  assert.match(result.filePath ?? '', /req-001\.json$/);
});

test('loadDocument returns parseFailure for malformed JSON', async () => {
  const root = await makeFixtureRoot('parse');
  await writeFile(join(root, 'rcf', 'requirements', 'req-001.json'), '{not valid json', 'utf8');
  const result = await loadDocument({ projectRoot: root, id: 'REQ-001' });
  assert.equal(result.kind, 'parseFailure');
  assert.equal(result.documentId, 'REQ-001');
});

test('loadDocument returns validation error for a bad document', async () => {
  const root = await makeFixtureRoot('validate');
  await writeFile(join(root, 'rcf', 'requirements', 'req-001.json'), JSON.stringify({ reqId: 'REQ-001', priority: 'must-do' }), 'utf8');
  const result = await loadDocument({ projectRoot: root, id: 'REQ-001' });
  assert.equal(result.kind, 'validation');
  assert.equal(result.documentId, 'REQ-001');
});

test('loadDocument returns the doc on a valid load', async () => {
  const root = await makeFixtureRoot('valid');
  const req = {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: 't',
    description: 'd',
    category: 'functional',
    domain: 'core',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'requirements', 'req-001.json'), JSON.stringify(req), 'utf8');
  const result = await loadDocument({ projectRoot: root, id: 'REQ-001' });
  assert.equal(result.kind, 'req');
  assert.equal(result.doc.reqId, 'REQ-001');
  assert.equal(typeof result.raw, 'string');
});

test('loadDocument flags unknown id shapes as usage errors', async () => {
  const root = await makeFixtureRoot('usage');
  const result = await loadDocument({ projectRoot: root, id: 'XYZ-999' });
  assert.equal(result.kind, 'usage');
  assert.equal(result.documentId, 'XYZ-999');
});

test('loadRootDocument loads the manifest', async () => {
  const root = await makeFixtureRoot('manifest');
  const manifest = {
    version: '2.0.0',
    projectName: 'X',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
  };
  await writeFile(join(root, 'rcf', 'manifest.json'), JSON.stringify(manifest), 'utf8');
  const loaded = await loadRootDocument({ projectRoot: root, kind: 'manifest' });
  assert.equal(loaded.kind, 'manifest');
  assert.equal(loaded.doc.projectName, 'X');
});
