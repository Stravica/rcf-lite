// US-17505 (REQ-175, FBS-245): readiness on a frozen tree with nothing
// pending. Right after `rcf define freeze`, a tree whose delta is empty
// (no document changed, added or removed since the freeze) has nothing
// waiting on anyone: D1 brief:sinceFreeze is not applicable there, the
// way D2 to D5 already fold to notApplicable on that empty delta. A
// frozen tree with a non-empty delta still asks for a brief statement
// since the freeze.
//
// Every case drives the app entry, bin/rcf.js, through the shared
// harness (GR-40): the fixture project is made by rcf init and rcf
// discover journey declare --ui none (test/_harness/fixture.js), its
// chain records are shaped by writing their JSON in the scratch copy,
// it is frozen through rcf define freeze, and readiness is read through
// rcf define readiness (text and --json). AC-17505-2 also reads the
// viewer's Readiness tab from rcf audit view over loopback
// (test/_harness/servers.js), so the verdict and tree lines are the
// shared formatter's output as both surfaces print it. Imports: Node
// builtins and test/_harness/ only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lines, rcf } from '../_harness/spawn.js';
import { viewerPage } from '../_harness/servers.js';
import { json } from '../_harness/capture.js';
import { project, readJson, writeJson, writeText } from '../_harness/fixture.js';

const AT = '2026-11-01T09:00:00Z';

/**
 * A freezeable synthetic tree: one REQ, one US with a happy, a failure
 * and a must-not AC, one TAC with an httpRoute interface, one deploy
 * ADR, a TAD with security and operational fields, one FBS, one brief
 * statement, the five applicable concerns waived, and profile markers.
 *
 * @param {string} root
 * @param {{ fbsStatus?: string }} [opts]
 */
function seedFreezeableTree(root, { fbsStatus = 'notStarted' } = {}) {
  writeText(root, 'rcf/.identity/profile.md', '## Register\nproductOwner\n\n## Surface\nviewer\n');
  writeJson(root, 'rcf/requirements/req-001.json', {
    reqId: 'REQ-001', prdId: 'PRD-001', title: 'ship the widget',
    description: 'One real requirement to ship the widget end-to-end.',
    category: 'functional', domain: 'ops', priority: 'must', version: '0.1.0', status: 'draft',
    shapeClassification: { shapes: ['httpApi'], reason: 'keyword-scan', classifiedAt: AT },
    createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/user-stories/us-101.json', {
    usId: 'US-101', prdId: 'PRD-001', reqId: 'REQ-001', version: '0.1.0', status: 'draft',
    title: 'operator ships widget', asA: 'operator', iWant: 'to ship the widget', soThat: 'downstream teams can use it',
    tacIds: ['TAC-001'],
    acceptanceCriteria: [
      { id: 'AC-101-1', testable: true, description: '[happy] operator ships widget', ownerRef: { tacId: 'TAC-001', field: 'interfaces[ship]' } },
      { id: 'AC-101-2', testable: true, description: '[failure] server returns 500' },
      { id: 'AC-101-3', testable: true, description: '[must-not] endpoint accepts unauth' },
    ],
    createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/tacs/tac-001.json', {
    tacId: 'TAC-001', prdId: 'PRD-001', tadId: 'TAD-001', version: '0.1.0', status: 'draft',
    name: 'widget shipper', purpose: 'Ships the widget over http.',
    responsibilities: ['Accept a POST', 'Return 201 with the widget id'],
    interfaces: [{ name: 'ship', kind: 'httpRoute', description: 'method: POST\npath: /widgets\nrequest: { widget }\nresponse: { id }\nerrors: [422]' }],
    createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/adrs/adr-001.json', {
    adrId: 'ADR-001', prdId: 'PRD-001', tadId: 'TAD-001', version: '0.1.0', status: 'accepted',
    title: 'Deploy target: a single server', context: 'Deployment target chosen.', decision: 'Use one server.',
    consequences: 'Ownership stays with the ops team.', createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/tad.json', {
    tadId: 'TAD-001', prdId: 'PRD-001', version: '0.1.0', status: 'draft',
    systemOverview: {
      executiveSummary: 'Widget system.', systemPurpose: 'Ship widgets.',
      architecturalApproach: 'One http service, one datastore.', keyCapabilities: ['ship widgets'],
    },
    securityArchitecture: { authenticationPattern: 'jwt bearer with rotating refresh tokens', authorizationModel: 'per-user scopes' },
    operationalConcerns: { healthChecks: 'GET /healthz returns 200 with build info', logging: 'structured JSON to stdout' },
    createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/fbs/fbs-001.json', {
    fbsId: 'FBS-001', prdId: 'PRD-001', bsId: 'BS-001', buildOrder: 1, executionStatus: fbsStatus,
    title: 'ship the widget', summary: 'Implement the http route and its three ACs.',
    acIds: ['AC-101-1', 'AC-101-2', 'AC-101-3'], dependsOnFbsIds: [], createdAt: AT, updatedAt: AT,
  });
  writeJson(root, 'rcf/define/brief-ledger.json', {
    ledger: 'brief',
    statements: [{ id: 1, kind: 'capability', text: 'ship the widget', resolvedBy: 'REQ-001', status: 'open', addedAt: AT }],
  });
  const concerns = ['auth', 'errorEnvelope', 'loggingAudit', 'performance', 'concurrencyIdempotency'];
  writeJson(root, 'rcf/define/concern-ledger.json', {
    ledger: 'concerns',
    concerns: concerns.map((concern, i) => ({
      id: i + 1, reqId: 'REQ-001', concern, disposition: 'waived', reason: 'test fixture',
      status: 'resolved', addedAt: AT, resolvedAt: AT,
    })),
  });
}

/**
 * A fixture project (rcf init, D0 declared none), seeded and frozen
 * through rcf define freeze; returns its root. The freeze must succeed
 * (exit 0) so every case starts from a real freeze record.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ fbsStatus?: string, name?: string }} [opts]
 */
async function frozenProject(t, { name = 'frozen', ...opts } = {}) {
  const root = await project(t, { name });
  seedFreezeableTree(root, opts);
  const freeze = await rcf(['define', 'freeze'], { cwd: root });
  assert.equal(freeze.code, 0, `freeze exit ${freeze.code}; stderr:\n${freeze.stderr}`);
  return root;
}

const readiness = (root, args = []) => rcf(['define', 'readiness', ...args], { cwd: root });

async function readinessJson(root) {
  const r = await readiness(root, ['--json']);
  assert.equal(r.code, 0, `readiness --json exit ${r.code}; stderr:\n${r.stderr}`);
  return json(r.stdout);
}

function stage(result, id) {
  const s = result.stages.find((x) => x.stage === id);
  assert.ok(s, `stage ${id} missing`);
  return s;
}

function check(result, stageId, name) {
  const c = stage(result, stageId).checks.find((x) => x.name === name);
  assert.ok(c, `check ${stageId}/${name} missing`);
  return c;
}

function assertEmptyDelta(result) {
  assert.equal(result.tree.frozen, true, 'the tree is frozen');
  assert.deepEqual(result.delta.changed, [], 'no document changed since the freeze');
  assert.deepEqual(result.delta.added, [], 'no document added since the freeze');
  assert.deepEqual(result.delta.removed, [], 'no document removed since the freeze');
  assert.deepEqual(result.delta.briefSince, [], 'no brief statement since the freeze');
}

function shortHashOf(result) {
  return result.tree.currentTreeHash.slice('sha256:'.length, 'sha256:'.length + 8);
}

function htmlDecode(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The viewer's page over loopback (rcf audit view), entity-decoded. */
async function readinessTab(root) {
  const page = await viewerPage(root, '/');
  assert.equal(page.status, 200, `viewer status ${page.status}; stderr:\n${page.stderr}`);
  assert.match(page.html, /class="rcf-readiness-panel"/, 'the viewer page carries the Readiness tab');
  return htmlDecode(page.html);
}

test('AC-17505-1: a frozen tree with an empty delta reads ready: brief:sinceFreeze ok at 0 of 0, D1 and D8 passed, both levels ok', async (t) => {
  const root = await frozenProject(t);
  const result = await readinessJson(root);
  assertEmptyDelta(result);

  const since = check(result, 'D1', 'brief:sinceFreeze');
  assert.equal(since.ok, true, `brief:sinceFreeze failing: ${JSON.stringify(since.failing)}`);
  assert.equal(since.total, 0, 'brief:sinceFreeze is not applicable on an empty delta (total 0)');
  assert.equal(since.pass, 0);
  assert.deepEqual(since.failing, []);

  assert.equal(stage(result, 'D1').state, 'passed');
  assert.equal(stage(result, 'D8').state, 'passed');
  assert.equal(check(result, 'D8', 'freeze:priorGates').ok, true);
  assert.equal(result.freezeable, true);
  assert.equal(result.levels.intentComplete.ok, true);
  assert.deepEqual(result.levels.intentComplete.blockedBy, []);
  assert.equal(result.levels.readyToBuild.ok, true);
  assert.deepEqual(result.levels.readyToBuild.blockedBy, []);
});

test('AC-17505-2: the CLI report and the Readiness tab read Ready-to-build yes, frozen with nothing pending, and on a fully built queue name every FBS built and read Built 1 of 1', async (t) => {
  // Nothing pending, the FBS not yet built.
  const root = await frozenProject(t);
  const result = await readinessJson(root);
  assertEmptyDelta(result);
  const h = shortHashOf(result);
  const intentLine = 'Intent-complete: yes. Every product-owner question is answered.';
  const buildLine = `Ready-to-build: yes. Frozen at ${h}; nothing pending.`;

  const text = await readiness(root);
  assert.equal(text.code, 0, text.stderr);
  const out = lines(text.stdout);
  assert.ok(out.includes(intentLine), `CLI report lacks "${intentLine}":\n${text.stdout}`);
  assert.ok(out.includes(buildLine), `CLI report lacks "${buildLine}":\n${text.stdout}`);
  assert.match(out[0], /Build at FBS-001 of 1; 0 FBS impacted\.$/);

  const html = await readinessTab(root);
  assert.ok(html.includes(intentLine), 'Readiness tab lacks the Intent-complete line');
  assert.ok(html.includes(buildLine), 'Readiness tab lacks the Ready-to-build line');

  // Nothing pending and every FBS built.
  const builtRoot = await frozenProject(t, { fbsStatus: 'complete', name: 'built' });
  const built = await readinessJson(builtRoot);
  assertEmptyDelta(built);
  const hb = shortHashOf(built);
  const builtLine = `Ready-to-build: yes. Frozen at ${hb}; nothing pending and every FBS built.`;

  const builtText = await readiness(builtRoot);
  assert.equal(builtText.code, 0, builtText.stderr);
  const builtOut = lines(builtText.stdout);
  assert.ok(builtOut.includes(intentLine), `CLI report lacks "${intentLine}":\n${builtText.stdout}`);
  assert.ok(builtOut.includes(builtLine), `CLI report lacks "${builtLine}":\n${builtText.stdout}`);
  assert.doesNotMatch(builtOut[0], /Build at \(none\)/);
  assert.match(builtOut[0], /\. Built 1 of 1; 0 FBS impacted\.$/);

  const builtHtml = await readinessTab(builtRoot);
  assert.ok(builtHtml.includes(builtLine), 'Readiness tab lacks the every-FBS-built Ready-to-build line');
  assert.ok(builtHtml.includes('Built 1 of 1; 0 FBS impacted.'), 'Readiness tab lacks the Built 1 of 1 tree line');
  assert.doesNotMatch(builtHtml, /Build at \(none\)/);
});

test('AC-17505-3: a frozen tree with an empty delta and a profile.md with no review-surface marker blocks on D1/brief:profile alone', async (t) => {
  const root = await frozenProject(t);
  // profile.md is not a tree document, so the delta stays empty.
  writeText(root, 'rcf/.identity/profile.md', '## Register\nproductOwner\n');
  const result = await readinessJson(root);
  assertEmptyDelta(result);

  const profile = check(result, 'D1', 'brief:profile');
  assert.equal(profile.ok, false);
  assert.deepEqual(profile.failing.map((f) => f.id), ['profile:surface']);

  const since = check(result, 'D1', 'brief:sinceFreeze');
  assert.equal(since.ok, true, `brief:sinceFreeze failing: ${JSON.stringify(since.failing)}`);
  assert.equal(since.total, 0);

  assert.equal(result.levels.intentComplete.ok, false);
  assert.deepEqual(
    result.levels.intentComplete.blockedBy.map((b) => `${b.stage}/${b.check}`),
    ['D1/brief:profile'],
  );
  assert.equal(result.levels.readyToBuild.ok, false);

  const text = await readiness(root);
  assert.ok(
    lines(text.stdout).includes('Intent-complete: no; 1 question for the product owner (D1/brief:profile).'),
    `CLI report:\n${text.stdout}`,
  );
  assert.match(text.stdout, /^Ready-to-build: no; /m);
});

test('AC-17505-4: a frozen tree with one changed document and no brief statement since the freeze still fails brief:sinceFreeze', async (t) => {
  const root = await frozenProject(t);
  const us = readJson(root, 'rcf/user-stories/us-101.json');
  us.title = 'operator ships widget (v2)';
  us.updatedAt = '2026-11-02T09:00:00Z';
  writeJson(root, 'rcf/user-stories/us-101.json', us);

  const result = await readinessJson(root);
  assert.equal(result.tree.frozen, true);
  assert.deepEqual(result.delta.changed, ['US-101']);
  assert.deepEqual(result.delta.briefSince, []);

  const since = check(result, 'D1', 'brief:sinceFreeze');
  assert.equal(since.ok, false);
  assert.deepEqual(since.failing, [{ id: 'brief-ledger', why: 'no new brief statement since the freeze' }]);
  assert.equal(stage(result, 'D1').state, 'failing');
  assert.equal(result.levels.readyToBuild.ok, false);
  assert.ok(result.levels.intentComplete.blockedBy.some((b) => b.stage === 'D1' && b.check === 'brief:sinceFreeze'));
});
