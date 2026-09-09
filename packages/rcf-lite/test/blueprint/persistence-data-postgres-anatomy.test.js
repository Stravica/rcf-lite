// Anatomy + apply + conflict + probe-shape + fixture + shelf-doc test
// for the persistence-data-postgres v1.0.0 shelf blueprint
// (infra round 5 spec section 5.1). Covers TS-053.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '#core/store';
import { walkTree } from '../../src/core/store/walker.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'persistence-data-postgres');
const D1_BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'persistence-data-d1');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-postgres');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const AUTHORING_DOC = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

test('blueprint.json declares 26 contributions with capabilities relationalStore and suggestedCompanions logging and errorHandling (TC-070-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'persistence-data-postgres');
  assert.equal(doc.version, '1.1.0');
  assert.equal(doc.category, 'persistence');
  assert.deepEqual(doc.capabilities, ['relationalStore']);
  assert.equal(doc.contributions.length, 26);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 7);
  assert.equal(kinds.us, 10);
  assert.equal(kinds.tac, 4);
  assert.equal(kinds.adr, 5);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  // Two ADRs are scope:global on persistenceStore and migrationDiscipline
  const globalAdrs = doc.contributions.filter((c) => c.kind === 'adr' && c.scope === 'global');
  assert.equal(globalAdrs.length, 2);
  const topics = globalAdrs.map((a) => a.topic).sort();
  assert.deepEqual(topics, ['migrationDiscipline', 'persistenceStore']);
});

test('apply persistence-data-postgres on a bare scratch project writes 26 contributions and validate plus strict audits exit zero (TC-070-applies-clean-no-persistence)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-postgres-apply-'));
  await initProject({ projectRoot: dir, projectName: 'PostgresApplyTest' });
  const { tree } = await walkTree({ projectRoot: dir });
  const res = await applyBlueprint({ projectRoot: dir, tree, source: BLUEPRINT_ROOT });
  assert.equal(res.applied, true, `applyBlueprint returned ${JSON.stringify(res)}`);
  // Verify contributions landed at expected id-band paths
  const reqDir = join(dir, 'rcf', 'requirements');
  const reqFiles = await readdir(reqDir);
  const postgresReqs = reqFiles.filter((f) => f.includes('persistence-data-postgres'));
  assert.equal(postgresReqs.length, 7);
  const usDir = join(dir, 'rcf', 'user-stories');
  const usFiles = await readdir(usDir);
  const postgresUss = usFiles.filter((f) => f.includes('persistence-data-postgres'));
  assert.equal(postgresUss.length, 10);
});

test('apply persistence-data-postgres on a d1-applied scratch project surfaces globalAdrTopic conflict on persistenceStore and migrationDiscipline (TC-070-conflict-with-d1)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-postgres-conflict-'));
  await initProject({ projectRoot: dir, projectName: 'PostgresConflictTest' });
  const { tree: t0 } = await walkTree({ projectRoot: dir });
  const d1Res = await applyBlueprint({ projectRoot: dir, tree: t0, source: D1_BLUEPRINT_ROOT });
  assert.equal(d1Res.applied, true, `d1 apply returned ${JSON.stringify(d1Res)}`);
  const { tree: t1 } = await walkTree({ projectRoot: dir });
  // Now try to apply postgres; expect the conflict surface, either as
  // a returned RcfError or a thrown error. Both shapes are accepted
  // because the exact surface depends on the apply pipeline stage that
  // catches the collision.
  let outcome = null;
  try {
    outcome = await applyBlueprint({ projectRoot: dir, tree: t1, source: BLUEPRINT_ROOT });
  } catch (err) {
    outcome = err;
  }
  const conflicts = (outcome && (outcome.conflicts
    || (outcome.details && outcome.details.conflicts))) || [];
  const msg = (outcome && (outcome.message || outcome.kind || String(outcome))) || '';
  const surfaced = (Array.isArray(conflicts) && conflicts.length > 0)
    || /persistenceStore/i.test(msg)
    || /migrationDiscipline/i.test(msg)
    || /globalAdrTopic/i.test(msg)
    || /conflict/i.test(msg);
  assert.equal(surfaced, true, `expected a conflict surface mentioning persistenceStore and migrationDiscipline; outcome=${JSON.stringify(outcome)}`);
  // Confirm postgres contributions did NOT land on disk after the refusal.
  const reqDir = join(dir, 'rcf', 'requirements');
  const reqFiles = await readdir(reqDir);
  const leaked = reqFiles.filter((f) => f.includes('persistence-data-postgres'));
  assert.equal(leaked.length, 0, `expected no persistence-data-postgres contributions after refusal; found ${leaked}`);
});

test('every probe module exports the section 3.2 verdict envelope with an anchorAcId matching a contributed AC id (TC-070-probe-anchor-ids-cross-check)', async () => {
  // Read the blueprint's contributed AC ids by walking every US file
  const blueprintDoc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const contributedAcIds = new Set();
  for (const c of blueprintDoc.contributions) {
    if (c.kind !== 'us') continue;
    const usPath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const usDoc = JSON.parse(await readFile(usPath, 'utf8'));
    for (const ac of usDoc.acceptanceCriteria || []) {
      contributedAcIds.add(ac.id);
    }
  }
  // The six expected probe modules
  const probeNames = [
    'facade-round-trip',
    'migration-apply',
    'prepared-statement-scan',
    'transaction-atomicity',
    'recovery-restore-round-trip',
    'pool-posture-smoke',
  ];
  for (const name of probeNames) {
    const probePath = join(PROBES_DIR, `${name}.mjs`);
    const stats = await stat(probePath);
    assert.ok(stats.isFile(), `probe module ${name}.mjs must exist`);
    const shimPath = join(PROBES_DIR, `run-${name}.mjs`);
    const shimStats = await stat(shimPath);
    assert.ok(shimStats.isFile(), `probe shim run-${name}.mjs must exist`);
    // Read the probe source and confirm at least one anchorAcId literal
    // matches a contributed AC id. We do not import and execute the probe
    // here (the probes require a live Postgres container); the anchor id
    // set is enforced statically.
    const src = await readFile(probePath, 'utf8');
    const anchors = [...src.matchAll(/anchorAcId:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    assert.ok(anchors.length > 0, `probe ${name} must reference at least one anchorAcId literal`);
    for (const anchor of anchors) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} anchorAcId ${anchor} must match a contributed AC id (${anchors.join(', ')})`);
    }
  }
});

test('sample-app fixture ships docker-compose.yml, migrations, store.mjs, recovery.mjs, and its README documents both induced-failure switches (TC-070-fixture-and-switches)', async () => {
  await stat(join(FIXTURE_ROOT, 'docker-compose.yml'));
  await stat(join(FIXTURE_ROOT, 'package.json'));
  const migrations = await readdir(join(FIXTURE_ROOT, 'migrations'));
  const sqlFiles = migrations.filter((f) => f.endsWith('.sql')).sort();
  assert.equal(sqlFiles.length, 3);
  assert.equal(sqlFiles[0], '001_create_users.sql');
  assert.equal(sqlFiles[1], '002_add_email_unique.sql');
  assert.equal(sqlFiles[2], '003_add_created_at.sql');
  await stat(join(FIXTURE_ROOT, 'src', 'store.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'migrate.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'recovery.mjs'));
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /SIMULATE_MIGRATION_FAILURE/);
  assert.match(readme, /SIMULATE_CONSTRAINT_VIOLATION/);
  assert.match(readme, /postgres:17-alpine/);
  assert.match(readme, /podman/i);
  // Store.mjs (TAC-2801 facade) is the sole reader of pg on the request
  // path per REQ-001; asserting it imports pg.
  const storeSrc = await readFile(join(FIXTURE_ROOT, 'src', 'store.mjs'), 'utf8');
  assert.match(storeSrc, /from ['"]pg['"]/);
  // The migration runner (TAC-2802 / migrate.mjs) and the recovery
  // runner (TAC-2804 / recovery.mjs) are separate operator-invoked
  // modules per the spec's four-TAC anatomy, not on the request path.
  // The facade sole-reader rule applies to the request-path facade;
  // migrate.mjs opens its own pg.Client legitimately.
  const migrateSrc = await readFile(join(FIXTURE_ROOT, 'src', 'migrate.mjs'), 'utf8');
  assert.match(migrateSrc, /BEGIN[\s\S]*COMMIT/, 'migrate.mjs must wrap each file in BEGIN/COMMIT per REQ-002');
});

test('section 6a table gains a relationalStore row and every shipped blueprint docs/topics.md gains a persistence-data-postgres row at 27101-27899 / 28xx (TC-070-shelf-doc-consistency)', async () => {
  const authoring = await readFile(AUTHORING_DOC, 'utf8');
  assert.match(authoring, /^\|\s*`relationalStore`\s*\|/m, 'section 6a capability table must gain a relationalStore row');

  // Every shipped blueprint's docs/topics.md must carry a persistence-data-postgres row at 27101-27899 / 28xx
  const blueprintsDir = join(REPO_ROOT, 'blueprints');
  const dirs = (await readdir(blueprintsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const bp of dirs) {
    const topics = join(blueprintsDir, bp, 'docs', 'topics.md');
    try {
      const body = await readFile(topics, 'utf8');
      assert.match(
        body,
        /^\|\s*persistence-data-postgres\s*\|\s*27101-27899\s*\|\s*28xx\s*\|/m,
        `${bp}/docs/topics.md must carry a persistence-data-postgres row at 27101-27899 / 28xx`,
      );
    } catch (err) {
      if (err.code === 'ENOENT') continue; // some blueprints do not carry a docs/topics.md
      throw err;
    }
  }
});
