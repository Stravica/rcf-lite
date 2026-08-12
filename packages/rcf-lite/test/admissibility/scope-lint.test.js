// Chain-admissibility scope-tag tests (NV-BL-ADM-02, NV-BL-ADM-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store';
import { scanAcScopeCoverage, scanTcScopeVsAc } from '#admissibility';

async function scaffold() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-admissibility-scope-'));
  await initProject({ projectRoot, projectName: 'AdmissibilityScopeTest' });
  return projectRoot;
}

async function reload(projectRoot) {
  return walkTree({ projectRoot });
}

test('scanAcScopeCoverage: an AC with no scope tag surfaces as a NV-BL-ADM-02 finding', async () => {
  const projectRoot = await scaffold();
  const { tree } = await reload(projectRoot);
  // The scaffold's AC-101-1..3 carry no scope tag by default (bootstrap
  // window). Assert findings for each with tolerateUnclassified: true --
  // absent is still a finding, only unclassified is tolerated.
  const findings = scanAcScopeCoverage(tree);
  assert.ok(findings.length >= 1, `expected at least one NV-BL-ADM-02 finding; got ${findings.length}`);
  for (const f of findings) {
    assert.equal(f.rule, 'NV-BL-ADM-02');
    assert.match(f.message, /no scope tag/);
  }
});

test('scanAcScopeCoverage: an AC scoped "unclassified" is tolerated during the migration window (default true)', async () => {
  const projectRoot = await scaffold();
  // Author a fresh US with a single scope: unclassified AC.
  const us = {
    usId: 'US-999',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '1.0.0',
    status: 'draft',
    title: 'unclassified AC bootstrap',
    asA: 'operator',
    iWant: 'the migration window to hold',
    soThat: 'chains authored before scope tags land keep validating',
    acceptanceCriteria: [
      { id: 'AC-999-1', description: 'placeholder', testable: true, scope: 'unclassified' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'user-stories', 'us-999.json'), JSON.stringify(us), 'utf8');
  const { tree } = await reload(projectRoot);
  const findings = scanAcScopeCoverage(tree);
  const forUs999 = findings.filter((f) => f.documentId === 'AC-999-1');
  assert.equal(forUs999.length, 0, 'unclassified AC should NOT surface during the migration window');
});

test('scanAcScopeCoverage: an AC scoped "unclassified" DOES surface when tolerateUnclassified is false', async () => {
  const projectRoot = await scaffold();
  const us = {
    usId: 'US-998',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '1.0.0',
    status: 'draft',
    title: 'unclassified post-migration',
    asA: 'operator', iWant: 'strict', soThat: 'strict',
    acceptanceCriteria: [
      { id: 'AC-998-1', description: 'still unclassified', testable: true, scope: 'unclassified' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'user-stories', 'us-998.json'), JSON.stringify(us), 'utf8');
  const { tree } = await reload(projectRoot);
  const findings = scanAcScopeCoverage(tree, { tolerateUnclassified: false });
  const forUs998 = findings.filter((f) => f.documentId === 'AC-998-1');
  assert.equal(forUs998.length, 1);
  assert.match(forUs998[0].message, /still scoped "unclassified"/);
});

test('scanTcScopeVsAc: a library-scope TC bound to a runtime-scope AC surfaces as NV-BL-ADM-03', async () => {
  const projectRoot = await scaffold();
  // Author a runtime-scope AC.
  const us = {
    usId: 'US-997',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '1.0.0',
    status: 'draft',
    title: 'runtime-scope AC',
    asA: 'operator', iWant: 'a runtime observable', soThat: 'the product boots',
    acceptanceCriteria: [
      { id: 'AC-997-1', description: 'boot observable', testable: true, scope: 'runtime' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'user-stories', 'us-997.json'), JSON.stringify(us), 'utf8');
  // Author a library-scope TC that binds it. Landmine 3 is unrelated here;
  // we use TS-100 within \d{3}.
  const ts = {
    id: 'TS-100',
    usId: 'US-997',
    title: 'library-scope test suite',
    purpose: 'Bind a library-scope TC to a runtime-scope AC and prove NV-BL-ADM-03 fires.',
    testLevel: 'unit',
    acIds: ['AC-997-1'],
    status: 'draft',
    testCases: [
      {
        id: 'TC-100-mismatch',
        acId: 'AC-997-1',
        description: 'library scope, runtime AC',
        status: 'pending',
        testPointer: 'test/x.test.js::x',
        scope: 'library',
      },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'test-suites', 'ts-100.json'), JSON.stringify(ts), 'utf8');
  const { tree } = await reload(projectRoot);
  const findings = scanTcScopeVsAc(tree);
  const mismatch = findings.find((f) => f.documentId === 'TC-100-mismatch');
  assert.ok(mismatch, `expected NV-BL-ADM-03 mismatch on TC-100-mismatch, got ${JSON.stringify(findings, null, 2)}`);
  assert.equal(mismatch.rule, 'NV-BL-ADM-03');
  assert.match(mismatch.message, /narrower/);
});

test('scanTcScopeVsAc: a deployed-scope TC bound to a runtime-scope AC is fine (wider is allowed)', async () => {
  const projectRoot = await scaffold();
  const us = {
    usId: 'US-996',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '1.0.0',
    status: 'draft',
    title: 'runtime AC, wider TC',
    asA: 'operator', iWant: 'wider testing', soThat: 'confidence',
    acceptanceCriteria: [
      { id: 'AC-996-1', description: 'runtime observable', testable: true, scope: 'runtime' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'user-stories', 'us-996.json'), JSON.stringify(us), 'utf8');
  const ts = {
    id: 'TS-101',
    usId: 'US-996',
    title: 'wider-scope test suite',
    purpose: 'Deployed TC covering a runtime AC is admissible.',
    testLevel: 'e2e',
    acIds: ['AC-996-1'],
    status: 'draft',
    testCases: [
      {
        id: 'TC-101-deployed-covers-runtime',
        acId: 'AC-996-1',
        description: 'deployed scope covers runtime',
        status: 'pending',
        testPointer: 'test/deploy.test.js::x',
        scope: 'deployed',
      },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(projectRoot, 'rcf', 'test-suites', 'ts-101.json'), JSON.stringify(ts), 'utf8');
  const { tree } = await reload(projectRoot);
  const findings = scanTcScopeVsAc(tree);
  const wrong = findings.find((f) => f.documentId === 'TC-101-deployed-covers-runtime');
  assert.equal(wrong, undefined, 'wider TC scope must not fire NV-BL-ADM-03');
});
