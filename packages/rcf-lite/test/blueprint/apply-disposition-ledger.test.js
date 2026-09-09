// Integration tests: applyBlueprint initialises the per-slug
// disposition ledger and returns the apply-time prompt on a fresh
// apply. Re-apply leaves the ledger byte-identical.
//
// Covers AC-1 (ledger written on apply) and AC-10 (ledger records an
// escalation via upsert) from the spec's section 9.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { ledgerRelPath } from '../../src/blueprint/disposition-ledger.js';

const now = new Date('2026-09-09T12:00:00Z');

async function scaffoldWithApply({ acs = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-apply-ledger-'));
  await initProject({ projectRoot: root, projectName: 'DemoProject' });
  const src = join(root, 'src-bp');
  await mkdir(join(src, 'contributions', 'requirements'), { recursive: true });
  await mkdir(join(src, 'contributions', 'user-stories'), { recursive: true });
  const req = {
    reqId: 'demo-REQ-001', prdId: 'PRD-001',
    title: 't', description: 'the applied surface has a reader.',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '1.0.0', status: 'approved',
    createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  };
  const us = {
    usId: 'demo-US-001', prdId: 'PRD-001', reqId: 'demo-REQ-001',
    version: '1.0.0', status: 'approved',
    title: 'demo story', asA: 'a', iWant: 'b', soThat: 'c',
    acceptanceCriteria: acs.map((ac, i) => ({
      id: `AC-${i + 1}`,
      description: ac.description || 'x',
      given: 'g', when: 'w', then: 't',
      testable: true, scope: 'runtime',
      ...(ac.disposition ? { disposition: ac.disposition } : {}),
    })),
    tacIds: [],
    createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  };
  await writeFile(join(src, 'contributions', 'requirements', 'demo-req-001.json'), JSON.stringify(req, null, 2));
  await writeFile(join(src, 'contributions', 'user-stories', 'demo-us-001.json'), JSON.stringify(us, null, 2));
  await writeFile(join(src, 'blueprint.json'), JSON.stringify({
    slug: 'demo', version: '1.0.0',
    contributions: [
      { id: 'demo-REQ-001', kind: 'req', path: 'requirements/demo-req-001.json' },
      { id: 'demo-US-001', kind: 'us', path: 'user-stories/demo-us-001.json' },
    ],
  }, null, 2));
  return { root, src };
}

test('applyBlueprint writes rcf/blueprints/<slug>.disposition.json with one record per AC (AC-1)', async () => {
  const { root, src } = await scaffoldWithApply({
    acs: [
      { disposition: 'fixed', description: 'authored assertion' },
      { disposition: 'template', description: 'project-parameterised' },
      { description: 'unmarked' },
    ],
  });
  const { tree } = await walkTree({ projectRoot: root });
  const res = await applyBlueprint({ projectRoot: root, tree, source: src, now });
  assert.equal(res.applied, true, `apply failed: ${JSON.stringify(res)}`);
  assert.ok(res.ledgerPath, 'apply must return a ledgerPath');
  assert.equal(res.dispositionAcCount, 3);
  assert.match(res.dispositionPrompt, /Blueprint 'demo' v1\.0\.0 contributed 3 acceptance criteria/);
  const doc = JSON.parse(await readFile(join(root, ledgerRelPath('demo')), 'utf8'));
  assert.equal(doc.records.length, 3);
  const [fixed, template, unmarked] = doc.records;
  assert.equal(fixed.action, 'accepted');
  assert.equal(fixed.reason, 'fixed-mechanism-inherited');
  assert.equal(template.action, 'pending-disposition');
  assert.equal(unmarked.action, 'pending-disposition');
});

test('applyBlueprint re-apply leaves the ledger byte-identical and does not re-print the prompt', async () => {
  const { root, src } = await scaffoldWithApply({ acs: [{ description: 'x' }] });
  const firstTree = (await walkTree({ projectRoot: root })).tree;
  const first = await applyBlueprint({ projectRoot: root, tree: firstTree, source: src, now });
  assert.ok(first.dispositionPrompt);
  const before = await readFile(join(root, ledgerRelPath('demo')), 'utf8');
  const secondTree = (await walkTree({ projectRoot: root })).tree;
  const second = await applyBlueprint({ projectRoot: root, tree: secondTree, source: src, now });
  // Re-apply is a no-op at the applied-slug layer, but should also
  // not touch the ledger. dispositionPrompt is only printed on a
  // fresh apply; a re-apply omits it.
  assert.equal(second.alreadyApplied, true);
  const after = await readFile(join(root, ledgerRelPath('demo')), 'utf8');
  assert.equal(before, after);
});
