// 0.30.0 PR 8 (US-17902; REQ-179 / TAC-4125 / AC-17902-2, AC-17902-3).
//
// NV-DL admissibility wrap: evaluateDefineAdmissibility reads the
// freeze record only.
//   - no freeze record -> refuse-nv-dl-adm-01 with rule 'NV-DL-ADM-01'
//   - freeze.override set -> ok with the override named back
//   - freeze.override null (but freeze.docHashes present) -> ok with
//     override: null (the tree is frozen cleanly; the override channel
//     is unused here)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateDefineAdmissibility } from '../../src/query/refuse-on-admissibility.js';

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-pr8-nvdl-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await writeFile(join(root, 'rcf', 'manifest.json'), '{}\n', 'utf8');
  return root;
}

async function writeFreeze(root, record) {
  const dir = join(root, 'rcf', 'define');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'freeze.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

test('NV-DL admissibility wrap (PR 8, AC-17902-2): refuses on an unfrozen tree citing NV-DL-ADM-01', async () => {
  const projectRoot = await makeProject();
  const verdict = await evaluateDefineAdmissibility({ projectRoot });
  assert.equal(verdict.verdict, 'refuse-nv-dl-adm-01');
  assert.equal(verdict.rule, 'NV-DL-ADM-01');
  assert.ok(typeof verdict.message === 'string' && verdict.message.length > 0);
});

test('NV-DL admissibility wrap (PR 8, AC-17902-3): freeze.override satisfies recordedInChain', async () => {
  const projectRoot = await makeProject();
  await writeFreeze(projectRoot, {
    frozenAt: '2026-10-03T18:00:00Z',
    treeHash: 'sha256:' + 'a'.repeat(64),
    docHashes: {},
    briefStatements: 0,
    override: { reason: 'hotfix', by: 'operator', at: '2026-10-03T18:00:00Z' },
  });
  const verdict = await evaluateDefineAdmissibility({ projectRoot });
  assert.equal(verdict.verdict, 'ok');
  assert.deepEqual(verdict.override, { reason: 'hotfix', by: 'operator', at: '2026-10-03T18:00:00Z' });
});

test('NV-DL admissibility wrap: a cleanly frozen tree (no override) also passes with override:null', async () => {
  const projectRoot = await makeProject();
  await writeFreeze(projectRoot, {
    frozenAt: '2026-10-03T18:00:00Z',
    treeHash: 'sha256:' + 'b'.repeat(64),
    docHashes: {},
    briefStatements: 0,
    override: null,
  });
  const verdict = await evaluateDefineAdmissibility({ projectRoot });
  assert.equal(verdict.verdict, 'ok');
  assert.equal(verdict.override, null);
});
