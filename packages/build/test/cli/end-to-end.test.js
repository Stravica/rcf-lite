// End-to-end scripted journey. Asserts that the tree stays schema-valid
// AND that `tree.childrenByParent` inverts correctly after every
// mutation. Covers a superset of the smoke steps in the brief §7.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { walkTree } from '@stravica-ai/rcf-lite-core/store/walker.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
  });
  return { stdout, stderr };
}

async function reload(projectRoot) {
  const { tree, errors } = await walkTree({ projectRoot });
  assert.equal(errors.length, 0, `expected clean tree, got: ${JSON.stringify(errors)}`);
  return tree;
}

test('scripted journey: init -> create req -> validate -> create us -> ac -> ts -> tc -> link -> update -> cascade delete -> validate', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-e2e-'));
  // 1. init.
  await runBin(tmp, ['init', '--project-name', 'E2E', '--non-interactive', '--quiet']);
  let tree = await reload(tmp);
  assert.deepEqual(tree.childrenByParent.get('PRD-001'), ['REQ-001']);
  assert.deepEqual(tree.childrenByParent.get('REQ-001'), ['US-101']);
  assert.deepEqual(tree.childrenByParent.get('TAD-001'), ['ADR-001', 'TAC-001']);
  assert.deepEqual(tree.childrenByParent.get('BS-001'), ['FBS-001']);

  // 2. create a second REQ under PRD-001. PRD file must not change.
  await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'Second REQ']);
  tree = await reload(tmp);
  const reqChildren = tree.childrenByParent.get('PRD-001');
  assert.ok(reqChildren.includes('REQ-002'));

  // 3. create a US under REQ-002.
  await runBin(tmp, ['create', 'us', '--parent', 'REQ-002', '--title', 'Second US']);
  tree = await reload(tmp);
  assert.deepEqual(tree.childrenByParent.get('REQ-002'), ['US-201']);

  // 4. create an AC on US-201.
  await runBin(tmp, ['create', 'ac', '--parent', 'US-201', '--description', 'second criterion']);
  tree = await reload(tmp);
  const us201 = tree.byId.get('US-201');
  assert.equal(us201.acceptanceCriteria.length, 2);

  // 5. create a TS on US-201.
  await runBin(tmp, [
    'create', 'ts', '--parent', 'US-201',
    '--title', 'S', '--purpose', 'p', '--test-level', 'unit',
    '--acs', 'AC-201-1',
  ]);
  tree = await reload(tmp);
  assert.ok(tree.childrenByParent.get('US-201').includes('TS-001'));

  // 6. create a TC.
  await runBin(tmp, [
    'create', 'tc', '--parent', 'TS-001',
    '--ac', 'AC-201-1', '--description', 'happy path',
  ]);
  tree = await reload(tmp);
  const ts = tree.byId.get('TS-001');
  assert.equal(ts.testCases.length, 1);

  // 7. link US-201 to TAC-001.
  await runBin(tmp, ['link', 'US-201', '--tac', 'TAC-001']);
  tree = await reload(tmp);
  assert.ok(tree.usByTacId.get('TAC-001').includes('US-201'));

  // 8. update REQ-002 title.
  await runBin(tmp, ['update', 'REQ-002', '--set', 'title=Renamed']);
  tree = await reload(tmp);
  assert.equal(tree.byId.get('REQ-002').title, 'Renamed');

  // 9. cascade delete REQ-002.
  await runBin(tmp, ['delete', 'REQ-002', '--cascade']);
  tree = await reload(tmp);
  assert.equal(tree.byId.get('REQ-002'), undefined);
  assert.equal(tree.byId.get('US-201'), undefined);
  assert.equal(tree.byId.get('TS-001'), undefined);
  // PRD-001 childrenByParent no longer includes REQ-002.
  const finalPrdChildren = tree.childrenByParent.get('PRD-001') ?? [];
  assert.ok(!finalPrdChildren.includes('REQ-002'));

  // 10. final validate.
  const clean = await runBin(tmp, ['validate']);
  assert.match(clean.stdout, /tree is clean/);
});
