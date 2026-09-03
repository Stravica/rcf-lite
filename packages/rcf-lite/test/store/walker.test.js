// Walker tests for the Phase 3.7 D7 load-then-invert algorithm. Every
// parent-child edge is encoded on the child (prdId, tadId, bsId, reqId,
// usId); the walker computes `parentByChild` + `childrenByParent` by
// inversion. Broken references surface as `brokenReference` errors with
// the exact file + field named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store/walker.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('walkTree on the live tree loads every document and returns zero errors', async () => {
  const { tree, errors } = await walkTree({ projectRoot: repoRoot });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  // 0.7.1 packaging consolidation added REQ-009 / US-901 / TS-025 for
  // the `rcf verify` subcommand routing (ratified R3).
  // Phase 1 blueprint mechanism (w-2026-08-18-016) added REQ-010 /
  // US-1001..1004 / TS-026..029 / FBS-016..019.
  // e2e contract (w-2026-09-03-dave-020) added REQ-011 + US-1101..1104
  // (four USs binding the four commits of the ratified spec). The USs
  // deliberately ship without paired TS entries in this train: the
  // acceptance criteria are runtime-scope and covered by the shipped code
  // paths' own suites (test/verify/**, test/cli/doctor-playwright.test.js,
  // test/cli/init-playwright.test.js, test/setup/playwright-checks.test.js,
  // test/blueprint/apply-spa-v1-4-0-schema.test.js). A follow-up train can
  // add TS-030..033 for the four USs if the ratified test-axis discipline
  // wants a paired TS per US on the dogfood tree; call recorded in the
  // shipping PR under Calls made.
  assert.equal(tree.requirements.length, 11);
  assert.equal(tree.userStories.length, 33);
  assert.equal(tree.tacs.length, 8);
  // Phase 3.5 rev-3 (w-2026-08-19-008) added ADR-010 recording the
  // topic-as-free-label-lookup-key decision (Baz ruling on shipped
  // camelCase topics).
  assert.equal(tree.adrs.length, 10);
  // e2e contract added FBS-020..023 to cover the four US-1101..1104 AC sets.
  assert.equal(tree.fbsItems.length, 23);
  // w-2026-07-28-005 step 4: the test axis is populated - one TS per US;
  // 0.7.1 added TS-025 to bind US-901. The four e2e-contract USs
  // (US-1101..1104) intentionally ship without paired TS entries, see
  // above.
  assert.equal(tree.testSuites.length, 29);
  assert.equal(tree.prd?.prdId, 'PRD-001');
  assert.equal(tree.tad?.tadId, 'TAD-001');
  assert.equal(tree.bs?.bsId, 'BS-001');
});

test('walkTree lists are sorted by id (D15 deterministic output)', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  const reqIds = tree.requirements.map((r) => r.reqId);
  assert.deepEqual(reqIds, [...reqIds].sort());
  const usIds = tree.userStories.map((u) => u.usId);
  assert.deepEqual(usIds, [...usIds].sort());
  const fbsIds = tree.fbsItems.map((f) => f.fbsId);
  assert.deepEqual(fbsIds, [...fbsIds].sort());
});

test('walkTree reports a missing manifest as a single missingFile error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-empty-'));
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'missingFile');
  assert.equal(tree.requirements.length, 0);
});

test('walkTree carries on past validation failures and aggregates errors (AC-102-2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-bad-req-'));
  await initProject({ projectRoot: root });
  // Corrupt the REQ to fail validation.
  await writeFile(
    join(root, 'rcf', 'requirements', 'req-001.json'),
    JSON.stringify({ reqId: 'REQ-001', priority: 'must-do' }),
    'utf8',
  );
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'validation' && e.documentId === 'REQ-001'));
  // Other docs still load.
  assert.ok(tree.tad);
  assert.ok(tree.bs);
});

test('walkTree reports a REQ with a broken prdId as brokenReference (D7 step 5, D8)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-broken-parent-'));
  await initProject({ projectRoot: root });
  const reqPath = join(root, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await import('node:fs').then((m) => m.readFileSync(reqPath, 'utf8')));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'REQ-001');
  assert.ok(broken, JSON.stringify(errors, null, 2));
  assert.equal(broken.field, 'prdId');
  assert.match(broken.filePath ?? '', /req-001\.json$/);
});

test('walkTree reports parseFailure without crashing the walk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-parse-'));
  await initProject({ projectRoot: root });
  await writeFile(join(root, 'rcf', 'user-stories', 'us-101.json'), '{not json', 'utf8');
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'parseFailure' && e.documentId === 'US-101'));
  assert.ok(tree.tad);
});

test('walkTree reports unknown FBS dependsOnFbsIds as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-dep-'));
  await initProject({ projectRoot: root });
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fbsPath, 'utf8')));
  fbs.dependsOnFbsIds = ['FBS-999'];
  await writeFile(fbsPath, JSON.stringify(fbs), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'FBS-001');
  assert.ok(broken, JSON.stringify(errors, null, 2));
  assert.match(broken.field ?? '', /dependsOnFbsIds/);
});

test('walkTree byId map covers every loaded document', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  assert.ok(tree.byId.has('PRD-001'));
  assert.ok(tree.byId.has('REQ-002'));
  assert.ok(tree.byId.has('US-201'));
  assert.ok(tree.byId.has('FBS-003'));
});

test('walkTree computes parentByChild by inverting child-borne parent fields', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  assert.equal(tree.parentByChild.get('REQ-001'), 'PRD-001');
  assert.equal(tree.parentByChild.get('US-201'), 'REQ-002');
  assert.equal(tree.parentByChild.get('TAC-001'), 'TAD-001');
  assert.equal(tree.parentByChild.get('ADR-001'), 'TAD-001');
  assert.equal(tree.parentByChild.get('FBS-001'), 'BS-001');
});

test('walkTree computes childrenByParent by inversion (PRD has REQ-001..REQ-011)', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  const reqChildren = tree.childrenByParent.get('PRD-001') ?? [];
  assert.deepEqual(reqChildren, ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006', 'REQ-007', 'REQ-008', 'REQ-009', 'REQ-010', 'REQ-011']);
  const tadChildren = tree.childrenByParent.get('TAD-001') ?? [];
  // TAD gathers both TAC and ADR children.
  for (const id of ['TAC-001', 'TAC-002', 'TAC-007', 'ADR-001', 'ADR-005']) {
    assert.ok(tadChildren.includes(id), `expected TAD-001 to carry ${id}`);
  }
});

test('walkTree computes fbsByAcId and dependentsByFbsId cross-link inversions (D4)', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  const fbsForAc = tree.fbsByAcId.get('AC-201-1') ?? [];
  assert.ok(fbsForAc.includes('FBS-003'), `expected FBS-003 to deliver AC-201-1, got ${fbsForAc.join(',')}`);
  // FBS-002 depends on FBS-001 in the migrated dogfood; the dependents map
  // is keyed on the dependency, listing dependants.
  const dependantsOfFbs001 = tree.dependentsByFbsId.get('FBS-001') ?? [];
  assert.ok(dependantsOfFbs001.includes('FBS-002'));
});

test('walkTree flags a US whose reqId does not resolve as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-orphan-us-'));
  await initProject({ projectRoot: root });
  const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = JSON.parse(await import('node:fs').then((m) => m.readFileSync(usPath, 'utf8')));
  us.reqId = 'REQ-999';
  await writeFile(usPath, JSON.stringify(us), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'US-101' && e.field === 'reqId');
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags a TAC with a broken tadId as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-tac-parent-'));
  await initProject({ projectRoot: root });
  const tacPath = join(root, 'rcf', 'tacs', 'tac-001.json');
  const tac = JSON.parse(await import('node:fs').then((m) => m.readFileSync(tacPath, 'utf8')));
  tac.tadId = 'TAD-999';
  await writeFile(tacPath, JSON.stringify(tac), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'TAC-001' && e.field === 'tadId');
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags an ADR with a broken tadId as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-adr-parent-'));
  await initProject({ projectRoot: root });
  const adrPath = join(root, 'rcf', 'adrs', 'adr-001.json');
  const adr = JSON.parse(await import('node:fs').then((m) => m.readFileSync(adrPath, 'utf8')));
  adr.tadId = 'TAD-999';
  await writeFile(adrPath, JSON.stringify(adr), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'ADR-001' && e.field === 'tadId');
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags an FBS with an unknown acId as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-ac-'));
  await initProject({ projectRoot: root });
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fbsPath, 'utf8')));
  fbs.acIds = ['AC-999-1'];
  await writeFile(fbsPath, JSON.stringify(fbs), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'FBS-001' && (e.field ?? '').includes('acIds'));
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags an FBS.contextRequirements.tacIds broken cross-link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-ctx-tac-'));
  await initProject({ projectRoot: root });
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fbsPath, 'utf8')));
  fbs.contextRequirements = { tacIds: ['TAC-999'] };
  await writeFile(fbsPath, JSON.stringify(fbs), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && (e.field ?? '').includes('contextRequirements.tacIds'));
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags an FBS.contextRequirements.adrIds broken cross-link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-ctx-adr-'));
  await initProject({ projectRoot: root });
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fbsPath, 'utf8')));
  fbs.contextRequirements = { adrIds: ['ADR-999'] };
  await writeFile(fbsPath, JSON.stringify(fbs), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && (e.field ?? '').includes('contextRequirements.adrIds'));
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree flags an inline AC id whose prefix mismatches its parent US number', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-ac-prefix-'));
  await initProject({ projectRoot: root });
  const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = JSON.parse(await import('node:fs').then((m) => m.readFileSync(usPath, 'utf8')));
  us.acceptanceCriteria = [
    { id: 'AC-999-1', description: 'wrong prefix', testable: true },
  ];
  await writeFile(usPath, JSON.stringify(us), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.rule === 'idPrefixMatchesParent');
  assert.ok(broken, JSON.stringify(errors, null, 2));
});

test('walkTree computes tsByAcId inversion for a valid TS (D4)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-ts-ac-'));
  await initProject({ projectRoot: root });
  const tsDir = join(root, 'rcf', 'test-suites');
  await import('node:fs/promises').then((m) => m.mkdir(tsDir, { recursive: true }));
  await writeFile(join(tsDir, 'ts-001.json'), JSON.stringify({
    id: 'TS-001',
    usId: 'US-101',
    title: 'smoke',
    purpose: 'p',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [{ id: 'TC-001-happy', acId: 'AC-101-1', description: 'happy', status: 'pending', testPointer: 'test/happy.test.js::happy' }],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }), 'utf8');
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.testSuites.length, 1);
  assert.deepEqual(tree.tsByAcId.get('AC-101-1'), ['TS-001']);
  assert.equal(tree.parentByChild.get('TS-001'), 'US-101');
  // Inline TCs land in tcsByAcId.
  const tcs = tree.tcsByAcId.get('AC-101-1') ?? [];
  assert.equal(tcs.length, 1);
  assert.equal(tcs[0].tsId, 'TS-001');
  assert.equal(tcs[0].tcId, 'TC-001-happy');
});

test('walkTree exposes an empty usByTacId map on the live tree (US.tacIds optional cross-link, spec D4)', async () => {
  // US.tacIds is an optional D4 cross-link. Shipped 0.2.0 schemas do not
  // yet permit it (Dispatch A OQ-P37-1 open); the walker inverts if any
  // US carries it, otherwise the map stays empty. This test locks the
  // no-tacIds baseline for the dogfood tree.
  const { tree } = await walkTree({ projectRoot: repoRoot });
  assert.equal(tree.usByTacId.size, 0);
});

test('walkTree is idempotent: same input yields structurally identical output', async () => {
  const a = await walkTree({ projectRoot: repoRoot });
  const b = await walkTree({ projectRoot: repoRoot });
  assert.equal(a.tree.requirements.length, b.tree.requirements.length);
  assert.equal(a.tree.fbsItems.length, b.tree.fbsItems.length);
  assert.deepEqual(
    [...a.tree.childrenByParent.entries()].sort(),
    [...b.tree.childrenByParent.entries()].sort(),
  );
});

test('walkTree resolves a valid dependsOnFbsIds edge and records it in dependentsByFbsId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-dep-ok-'));
  await initProject({ projectRoot: root });
  // Add a second FBS that depends on FBS-001.
  await writeFile(join(root, 'rcf', 'fbs', 'fbs-002.json'), JSON.stringify({
    fbsId: 'FBS-002',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 2,
    executionStatus: 'notStarted',
    title: 'follow-up',
    summary: 's',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: ['FBS-001'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }), 'utf8');
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  const deps = tree.dependentsByFbsId.get('FBS-001') ?? [];
  assert.ok(deps.includes('FBS-002'));
});

test('walkTree records a valid childrenByParent entry for a fresh init tree (single REQ)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fresh-'));
  await initProject({ projectRoot: root });
  const { tree } = await walkTree({ projectRoot: root });
  assert.deepEqual(tree.childrenByParent.get('PRD-001'), ['REQ-001']);
  assert.deepEqual(tree.childrenByParent.get('REQ-001'), ['US-101']);
});

test('walkTree tolerates a fresh tree with an empty test-suites/ directory (D14)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-empty-ts-'));
  await initProject({ projectRoot: root });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.testSuites.length, 0);
});

test('walkTree kindById lookup returns the correct kind for every loaded doc', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  assert.equal(tree.kindById.get('PRD-001'), 'prd');
  assert.equal(tree.kindById.get('REQ-001'), 'req');
  assert.equal(tree.kindById.get('US-101'), 'userStory');
  assert.equal(tree.kindById.get('TAD-001'), 'tad');
  assert.equal(tree.kindById.get('TAC-001'), 'tac');
  assert.equal(tree.kindById.get('ADR-001'), 'adr');
  assert.equal(tree.kindById.get('BS-001'), 'buildSequence');
  assert.equal(tree.kindById.get('FBS-001'), 'fbs');
});

test('walkTree produces stable childrenByParent lists (deterministic ordering)', async () => {
  const a = await walkTree({ projectRoot: repoRoot });
  const b = await walkTree({ projectRoot: repoRoot });
  const aReqs = a.tree.childrenByParent.get('PRD-001');
  const bReqs = b.tree.childrenByParent.get('PRD-001');
  assert.deepEqual(aReqs, bReqs);
});

test('walkTree flags duplicate buildOrder within a BS as brokenReference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-dup-order-'));
  await initProject({ projectRoot: root });
  // Add a second FBS with the same buildOrder as FBS-001.
  const fbs002Path = join(root, 'rcf', 'fbs', 'fbs-002.json');
  await writeFile(fbs002Path, JSON.stringify({
    fbsId: 'FBS-002',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 1,
    executionStatus: 'notStarted',
    title: 'dup',
    summary: 'dup',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  const dup = errors.find((e) => e.rule === 'uniqueBuildOrderPerBs');
  assert.ok(dup, JSON.stringify(errors, null, 2));
});

// ---------------------------------------------------------------------------
// 0.8.0 slug-train (w-2026-07-28-012 landmine 1): the walker used to derive
// tree ids by upper-casing the whole filename stem. Fine while every id was
// `<PREFIX>-<digits>`. The moment a slug lands (rcf-schemas 0.4.3 admits
// FBS-004-user-login), the whole-stem fold produces FBS-004-USER-LOGIN in
// tree.byId while the body's fbsId + every inbound reference use the
// lower-case form; the graph silently detaches. This test is the single most
// important regression guard for the slug design and must land BEFORE any
// slug-consuming change (allocator, TC-prefix widen, deriveSlug leak).
// ---------------------------------------------------------------------------
test('walkTree preserves case on slug tails when deriving id from filename (0.8.0 landmine 1)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-slug-tail-'));
  await initProject({ projectRoot: root });
  // Author a slugged FBS: filename lower-case kebab (fbs-004-user-login.json),
  // body's fbsId matches (FBS-004-user-login).
  const slugFbs = {
    fbsId: 'FBS-004-user-login',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    title: 'User login',
    summary: 'Slug design regression fixture: exercise walker prefix-only-upper.',
    approach: 'Prove the walker preserves the slug tail case verbatim so byId keys resolve inbound references.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    buildOrder: 2,
    executionStatus: 'notStarted',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'fbs', 'fbs-004-user-login.json'), JSON.stringify(slugFbs), 'utf8');
  // Author a second FBS that references FBS-004-user-login via
  // dependsOnFbsIds: the graph must resolve this without a brokenReference,
  // proving byId keys the slugged id verbatim rather than a whole-stem fold.
  const referencingFbs = {
    fbsId: 'FBS-005',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    title: 'Depends on user-login',
    summary: 'Inbound reference proof: build sequence carrying FBS-004-user-login as a dep.',
    approach: 'Assert the inbound reference resolves to the byId entry the walker keyed from the slugged filename.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: ['FBS-004-user-login'],
    buildOrder: 3,
    executionStatus: 'notStarted',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'fbs', 'fbs-005.json'), JSON.stringify(referencingFbs), 'utf8');

  const { tree, errors } = await walkTree({ projectRoot: root });

  // The slugged id is keyed in byId with its slug tail verbatim (lower-case).
  // A regression here (whole-stem toUpperCase) would key it as
  // FBS-004-USER-LOGIN and the assertion below would fail.
  assert.ok(tree.byId.has('FBS-004-user-login'), `byId missing slugged id; keys: ${[...tree.byId.keys()].join(',')}`);
  assert.equal(tree.kindById.get('FBS-004-user-login'), 'fbs');

  // The critical property: the inbound dependsOnFbsIds reference resolves to
  // the byId entry the walker keyed from the slugged filename. A silent
  // graph detachment would surface as a brokenReference on FBS-005.
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.field?.startsWith('dependsOnFbsIds'));
  assert.equal(broken, undefined, `unexpected brokenReference on the slug tail: ${JSON.stringify(broken, null, 2)}`);
  const dependents = tree.dependentsByFbsId.get('FBS-004-user-login') ?? [];
  assert.ok(dependents.includes('FBS-005'), `dependentsByFbsId did not invert the slugged edge; got ${dependents.join(',')}`);
});

// ---------------------------------------------------------------------------
// w-2026-08-19-001: rcf-schemas 0.4.4 prefix-family blueprint namespacing.
//
// The suffix-family case (FBS-004-user-login above) worked pre-fix because
// its filename stem still starts with the family prefix. Prefix families
// (REQ / US / PRD / BS / TAD / TS) namespace by prepending a lowercase
// slug: `spa-REQ-001` -> `spa-req-001.json`. Pre-fix, `idFromFilenameStem`
// split on the first dash and upper-cased only the leading segment, so
// the stem became `SPA-req-001` -- an id `pathForId` did not recognise
// and `byId` keyed under the wrong string. The fix routes both walker
// and loader through the shared `parseIdParts` seat.
// ---------------------------------------------------------------------------
test('walkTree keys prefix-family slug-prefixed ids under the correct id (0.4.4 grammar, w-2026-08-19-001)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-prefix-slug-'));
  await initProject({ projectRoot: root });
  // Prefix-family: filename stem `spa-req-001` derives id `spa-REQ-001`
  // (slug lower-case, family upper-case, digits verbatim).
  const spaReq = {
    reqId: 'spa-REQ-001',
    prdId: 'PRD-001',
    title: 'SPA prefix REQ',
    description: 'w-2026-08-19-001 regression: derive prefix-family id from a slug-prefixed filename stem.',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  await writeFile(join(root, 'rcf', 'requirements', 'spa-req-001.json'), JSON.stringify(spaReq), 'utf8');

  const { tree, errors } = await walkTree({ projectRoot: root });

  // Pre-fix this key was `SPA-req-001` (whole leading segment upper-cased)
  // and the doc silently detached from the graph.
  assert.ok(tree.byId.has('spa-REQ-001'),
    `byId missing prefix-namespaced id; keys: ${[...tree.byId.keys()].join(',')}`);
  assert.equal(tree.kindById.get('spa-REQ-001'), 'req');

  // No `Unrecognised document id` (usage) error from loadDocument.
  const usageErr = errors.find((e) => e.kind === 'usage');
  assert.equal(usageErr, undefined, `unexpected usage error: ${JSON.stringify(usageErr, null, 2)}`);
});


test('walkTree upper-cases the prefix segment on numeric-only ids unchanged (0.8.0 landmine 1 back-compat)', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  // Every existing numeric-only id continues to key by its canonical upper-cased
  // prefix; the landmine fix is additive and does not touch pre-slug behaviour.
  assert.equal(tree.kindById.get('REQ-001'), 'req');
  assert.equal(tree.kindById.get('FBS-003'), 'fbs');
  assert.equal(tree.kindById.get('TS-001'), 'testSuite');
});
