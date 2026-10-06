// Regression test for issue 307 (2026-10-06): the viewer's readiness
// compute shares the TAC-interface `path:` pre-resolve with the CLI
// readiness and freeze CLIs. Pre-fix, `renderModelToPage` called
// `computeReadiness` without `resolvedPaths`, D3 `shapes:pathsResolve`
// false-failed on paths that resolved on disk, and the viewer
// disagreed with `rcf define readiness`.
//
// This test builds a minimal seedable tree with one TAC-interface
// `path:` token, writes the file at that path, invokes
// `renderModelToPage` and asserts D3 `shapes:pathsResolve` passes.
// Negative control: same tree with the file absent; the check fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { renderModelToPage } from '../../src/view/index.js';

async function writeJson(path, body) {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

async function scratchProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await initProject({ projectRoot: root });
  return root;
}

async function seedTreeWithInterfacePath(root, { pathToken }) {
  await writeJson(join(root, 'rcf', 'requirements', 'req-001.json'), {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: 'ship the widget',
    description: 'One real requirement to ship the widget end-to-end.',
    category: 'functional',
    domain: 'ops',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    shapeClassification: {
      shapes: ['httpApi'],
      reason: 'keyword-scan',
      classifiedAt: '2026-09-24T16:00:00Z',
    },
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'user-stories', 'us-101.json'), {
    usId: 'US-101',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '0.1.0',
    status: 'draft',
    title: 'operator ships widget',
    asA: 'operator',
    iWant: 'to ship the widget',
    soThat: 'downstream teams can use it',
    tacIds: ['TAC-001'],
    acceptanceCriteria: [
      { id: 'AC-101-1', testable: true, description: '[happy] operator ships widget', ownerRef: { tacId: 'TAC-001', field: 'interfaces[ship]' } },
    ],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'tacs', 'tac-001.json'), {
    tacId: 'TAC-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'draft',
    name: 'widget shipper',
    purpose: 'Ships the widget over http.',
    responsibilities: ['Accept a POST', 'Return 201 with the widget id'],
    interfaces: [
      {
        name: 'ship',
        kind: 'httpRoute',
        description: `method: POST\npath: /widgets\nrequest: { widget }\nresponse: { id }\nerrors: [422]\ndoc path: ${pathToken}`,
      },
    ],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });
}

function findStage(readiness, stageName) {
  if (!readiness || !Array.isArray(readiness.stages)) return null;
  return readiness.stages.find((s) => s.stage === stageName) ?? null;
}

function findCheck(stage, checkName) {
  if (!stage || !Array.isArray(stage.checks)) return null;
  return stage.checks.find((c) => c.name === checkName) ?? null;
}

test('viewer (issue 307): shapes:pathsResolve passes when the TAC-interface path exists on disk', async () => {
  const root = await scratchProject('rcf-view-307-ok-');
  const pathToken = 'docs/ship-interface.md';
  await seedTreeWithInterfacePath(root, { pathToken });
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'ship-interface.md'), '# ship\n', 'utf8');

  const result = await renderModelToPage({ projectRoot: root });
  assert.ok(result.readiness, 'renderModelToPage must expose the computed readiness');
  const d3 = findStage(result.readiness, 'D3');
  assert.ok(d3, 'D3 stage present in readiness.stages');
  const paths = findCheck(d3, 'shapes:pathsResolve');
  assert.ok(paths, 'shapes:pathsResolve check present in D3');
  assert.equal(paths.ok, true, `shapes:pathsResolve must pass with the file on disk; got failing=${JSON.stringify(paths.failing)}`);
  assert.equal(paths.failing.length, 0, 'no failing entries when the path resolves');
  await rm(root, { recursive: true, force: true });
});

test('viewer (issue 307): shapes:pathsResolve fails when the TAC-interface path is missing (negative control)', async () => {
  const root = await scratchProject('rcf-view-307-missing-');
  const pathToken = 'docs/does-not-exist.md';
  await seedTreeWithInterfacePath(root, { pathToken });

  const result = await renderModelToPage({ projectRoot: root });
  assert.ok(result.readiness, 'renderModelToPage must expose the computed readiness');
  const d3 = findStage(result.readiness, 'D3');
  assert.ok(d3, 'D3 stage present in readiness.stages');
  const paths = findCheck(d3, 'shapes:pathsResolve');
  assert.ok(paths, 'shapes:pathsResolve check present in D3');
  assert.equal(paths.ok, false, 'shapes:pathsResolve must fail when the path is absent');
  assert.ok(paths.failing.some((f) => /does-not-exist/.test(f.id) || /does-not-exist/.test(f.why ?? '')), `expected a failing entry naming the missing path, got ${JSON.stringify(paths.failing)}`);
  await rm(root, { recursive: true, force: true });
});
