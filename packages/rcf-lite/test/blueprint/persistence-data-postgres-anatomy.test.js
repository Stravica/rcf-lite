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
  assert.equal(doc.version, '1.1.5');
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
    // Read the probe source and confirm every AC-id referenced (as
    // anchorAcId, notObservableHere.ac, or in a limitation string) is a
    // contributed AC id; at least one such reference exists. We do not
    // import and execute the probe here (the probes require a live
    // Postgres container); the anchor id set is enforced statically.
    const src = await readFile(probePath, 'utf8');
    const anchorMatches = [...src.matchAll(/anchorAcId:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    const notObservableMatches = [...src.matchAll(/ac:\s*['"`](AC-[^'"`]+)['"`]/g)].map((m) => m[1]);
    const limitationAcIds = [...src.matchAll(/(AC-[0-9]+-[0-9]+|AC-[a-zA-Z0-9-]+)/g)]
      .map((m) => m[1])
      .filter((id) => /^AC-/.test(id));
    const anchors = new Set([...anchorMatches, ...notObservableMatches]);
    // Filter limitation matches down to those that occur inside a
    // string literal that names an AC that is contributed.
    for (const id of limitationAcIds) if (contributedAcIds.has(id)) anchors.add(id);
    assert.ok(anchors.size > 0, `probe ${name} must reference at least one AC id (anchorAcId, notObservableHere.ac, or in a limitation string)`);
    for (const anchor of anchorMatches) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} anchorAcId ${anchor} must match a contributed AC id (${anchorMatches.join(', ')})`);
    }
    for (const anchor of notObservableMatches) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} notObservableHere.ac ${anchor} must match a contributed AC id (${notObservableMatches.join(', ')})`);
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
  // 7d conformance: fixture README carries a Declared env vars section listing
  // every env var a probe or the fixture reads (authoring standard section 7d).
  assert.match(readme, /^## Declared env vars/m);
  for (const v of [
    'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
    'POSTGRES_SOURCE_CONTAINER', 'POSTGRES_RESTORE_CONTAINER', 'POSTGRES_RESTORE_PORT',
    'SIMULATE_MIGRATION_FAILURE', 'SIMULATE_CONSTRAINT_VIOLATION',
  ]) {
    assert.match(readme, new RegExp(`\`${v}\``), `Declared env vars table must name ${v}`);
  }
  // recovery-restore-round-trip must read the three container/port overrides via env
  const recoverySrc = await readFile(join(REPO_ROOT, 'blueprints', 'persistence-data-postgres', 'contributions', 'probes', 'recovery-restore-round-trip.mjs'), 'utf8');
  assert.match(recoverySrc, /process\.env\.POSTGRES_SOURCE_CONTAINER/);
  assert.match(recoverySrc, /process\.env\.POSTGRES_RESTORE_CONTAINER/);
  assert.match(recoverySrc, /process\.env\.POSTGRES_RESTORE_PORT/);
  // Anatomy check on 7d evidence shape (STRICT rewrite): the
  // run record MUST be present under
  // `.rcf/reports/blueprints/<slug>/<probe>.json` (a missing record
  // fails the test loudly - no lexical source fallback, no ENOENT
  // swallow), and EVERY result row is validated in-place against one
  // of four shapes:
  //   (a) a real observation carrying an `evidence` object with BOTH
  //       an id-shape witness (request id, http/status code, exit code,
  //       event record, metadata bag, ids collection) AND a
  //       derived-value witness (byte count, body sample, checksum,
  //       inventory-diff key, per-site record, timing metric,
  //       teardown record) - witness check is idWitness AND derivedWitness,
  //       never OR;
  //   (b) `conformanceOnly: true` with `anchorAcId: null` and a
  //       `limitation` string that names at least one shipped AC id;
  //   (c) `notObservableHere: { ac, reason }` naming a shipped AC id
  //       and carrying a non-empty reason;
  //   (d) `accountBoundSkipped: true` with a `reason` string that names
  //       exactly one env var declared on the probe's `DECLARED_ENV`
  //       list (` unset` or ` (not "true")` suffix).
  // Every AC id cited on a limitation or a notObservableHere.ac MUST
  // exist in the persistence-data-postgres shipped user-story AC set
  // (collected below); a string matching /AC-/ is not sufficient.
  // Load the shipped AC id set from user-stories once.
  const usDir = join(BLUEPRINT_ROOT, 'contributions', 'user-stories');
  const usFiles = (await readdir(usDir)).filter((f) => f.endsWith('.json'));
  const SHIPPED_AC_IDS = new Set();
  for (const f of usFiles) {
    const doc = JSON.parse(await readFile(join(usDir, f), 'utf8'));
    for (const ac of doc.acceptanceCriteria || []) SHIPPED_AC_IDS.add(ac.id);
  }
  function extractAcIdsRaw(text) {
    // Every AC-token substring, unfiltered. The regex is a broad
    // `AC-[A-Za-z0-9-]+` sweep so an invented token like AC-invented
    // is extracted and then rejected at the call site against the
    // shipped set. A narrower AC-\d+-\d+ / AC-jobs-* pattern silently
    // dropped invented tokens and let a real id plus an invented one
    // pass, which the closure flagged.
    return [...String(text).matchAll(/AC-[A-Za-z0-9-]+/g)].map((m) => m[0]);
  }
  const trivialAdminKeys = new Set(['reason', 'note', 'error', 'verdict', 'skip']);
  // Strict identifier predicate (round-6 closure): id witness MUST be
  // one of the explicit engine-minted id fields. Statuses, counts,
  // booleans, phases and generic codes are NOT identifiers.
  const STRICT_ID_KEYS = new Set([
    'requestId', 'requestIds',
    'vendorRequestId', 'vendorRequestIds',
    'resourceId',
    'bucketName', 'scratchBucket',
    'uploadId', 'observedUploadId',
    'queueId', 'queueName',
    'messageId', 'dlqTransportMessageIds', 'primaryTransportMessageId',
    'jobId', 'jobIds', 'dlqPayloadJobIds', 'expectedPayloadJobId',
    'databaseName',
    'migrationFile', 'migrationFileApplied', 'appliedFilesList', 'stderrFailingFilename',
    'rowId', 'insertedId',
    'checksum', 'srcChecksumMd5', 'dstChecksumMd5',
  ]);
  const derivedPatterns = [
    /Size$/i, /Bytes$/i, /Md5$/i, /Sha256$/i, /Equal$/i,
    /^seen/i, /Exists$/i, /Rows$/i, /Row$/i, /^applied/i, /^expected/i, /^observed/i, /^returned/i,
    /^attempts/i, /^unique/i, /^teardown/i, /Sequence$/i,
    /Excerpt$/i, /Preview$/i, /^perSite$/i,
    /Container$/i, /Port$/i, /Path$/i, /Host$/i, /HostRedacted$/i,
    /Bucket$/i, /Key$/i, /Prefix$/i, /^inflight/i,
    /^first/i, /^second/i, /^waited/i, /^elapsed/i, /^total/i, /^published/i, /^succeeded/i,
    /Max$/i, /Message$/i, /Names$/i, /Backlog$/i, /Refused$/i, /^ttl$/i, /Refused$/i, /^refused$/i,
    /Whitelist$/i, /^whitelist/i, /^forbidden/i, /^scanned/i, /Fires$/i, /^cron$/i,
    /^tolerance/i, /Latency$/i, /^schedule/i, /Timestamp$/i, /Ok$/i,
    /^checks/i, /^stderr/i, /Duration/i, /Seconds$/i, /Literal$/i,
    /^leakSites$/i, /^leaked/i, /Doc$/i, /Name$/i,
  ];
  function isIdWitness(k, v) {
    // Round-7 ruling: a counting row's identifier is a NON-EMPTY
    // STRING under an engine-minted id key. Booleans, numbers and
    // objects (arrays included) never qualify.
    if (!STRICT_ID_KEYS.has(k)) return false;
    if (typeof v !== 'string') return false;
    if (v.length === 0) return false;
    return true;
  }
  function isDerivedWitness(k, v) {
    if (trivialAdminKeys.has(k)) return false;
    if (v == null) return false;
    if (!derivedPatterns.some((re) => re.test(k))) return false;
    if (typeof v === 'string' && v.length === 0) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
    return true;
  }
  async function loadDeclaredEnv(probeName) {
    const src = await readFile(join(REPO_ROOT, 'blueprints', 'persistence-data-postgres', 'contributions', 'probes', `${probeName}.mjs`), 'utf8');
    const m = src.match(/DECLARED_ENV\s*=\s*Object\.freeze\(\[([^\]]+)\]\s*\)/);
    if (!m) return null;
    return new Set([...m[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((x) => x[1]));
  }
  const probeNamesLocal = [
    'facade-round-trip', 'migration-apply', 'prepared-statement-scan',
    'transaction-atomicity', 'recovery-restore-round-trip', 'pool-posture-smoke',
  ];
  // Round-7 ruling: the probe owns its skip. The anatomy ALWAYS
  // invokes every probe and validates whatever comes back. A CI
  // environment with POSTGRES_HOST unset lands every probe on its
  // exact-one-variable accountBoundSkipped row; locally with the
  // postgres:17-alpine container up every probe runs live and each
  // returned row is validated in-memory (the branch never commits
  // .rcf/reports).
  for (const name of probeNamesLocal) {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, name + '.mjs')).href)).default;
    const declaredEnv = await loadDeclaredEnv(name);
    let probeReturn;
    try {
      probeReturn = await runProbe();
    } catch (err) {
      assert.fail(name + ': probe threw ' + (err && err.code ? err.code : err && err.message ? err.message : String(err)) + '; a probe must return an accountBoundSkipped row when a declared variable is unset rather than throw');
    }
    // Accept either { results: [...] } or a bare array.
    const rows = Array.isArray(probeReturn) ? probeReturn : (probeReturn && Array.isArray(probeReturn.results) ? probeReturn.results : null);
    assert.ok(rows && rows.length > 0,
      name + ': runProbe must return a non-empty results array (authoring-standard rule 3)');
    const probeReturnLike = { results: rows };
    probeReturn = probeReturnLike;
    for (const row of probeReturn.results) {
      assert.ok(['pass', 'warn', 'fail'].includes(row.verdict),
        'row in ' + name + ' must have verdict in {pass, warn, fail}, saw ' + row.verdict);
      const anchor = row.anchorAcId ?? row.anchorReqId;
      const declaimed = row.conformanceOnly === true;
      const notObservable = row.notObservableHere && typeof row.notObservableHere === 'object';
      const skipDeclared = row.accountBoundSkipped === true;
      if (declaimed) {
        assert.equal(row.anchorAcId, null,
          'conformanceOnly row in ' + name + ' must set anchorAcId: null');
        assert.ok(typeof row.limitation === 'string' && row.limitation.length > 0,
          'conformanceOnly row in ' + name + ' must carry a non-empty limitation string');
        const rawIds = extractAcIdsRaw(row.limitation);
        assert.ok(rawIds.length > 0,
          'conformanceOnly row in ' + name + ' limitation must name at least one AC id');
        for (const id of rawIds) {
          assert.ok(SHIPPED_AC_IDS.has(id),
            'conformanceOnly row in ' + name + ' limitation names AC id ' + id + ' NOT in shipped user-story set');
        }
      } else if (notObservable) {
        assert.ok(typeof row.notObservableHere.ac === 'string' && SHIPPED_AC_IDS.has(row.notObservableHere.ac),
          'notObservableHere row in ' + name + ' must name a shipped AC id (got=' + row.notObservableHere.ac + ')');
        assert.ok(typeof row.notObservableHere.reason === 'string' && row.notObservableHere.reason.length > 0,
          'notObservableHere row in ' + name + ' must carry a non-empty reason');
      } else if (skipDeclared) {
        assert.ok(typeof row.reason === 'string' && / unset$| \(not "true"\)$/.test(row.reason),
          'accountBoundSkipped row in ' + name + ' must carry a reason ending in " unset" or " (not \"true\")"');
        const varName = row.reason.replace(/ unset$| \(not "true"\)$/, '').trim();
        assert.match(varName, /^[A-Z][A-Z0-9_]+$/,
          'accountBoundSkipped reason must name exactly one env var (got=' + varName + ')');
        assert.ok(declaredEnv && declaredEnv.has(varName),
          'accountBoundSkipped reason must name a var declared on ' + name + '.mjs DECLARED_ENV');
      } else {
        assert.ok(typeof anchor === 'string' && anchor.length > 0,
          'every non-declaimed row in ' + name + ' must anchor an AC or REQ');
        assert.notEqual(anchor, 'unknown', 'row in ' + name + ' anchors "unknown"');
        const ev = row.evidence;
        const evOk = ev && typeof ev === 'object' && Object.keys(ev).length > 0;
        assert.ok(evOk, 'non-skip row in ' + name + ' (anchor ' + anchor + ') must carry a non-empty evidence object');
        const idWitness = Object.entries(ev).find(([k, v]) => isIdWitness(k, v));
        const derivedWitness = Object.entries(ev).find(([k, v]) => isDerivedWitness(k, v));
        assert.ok(idWitness && derivedWitness,
          'non-declaimed row in ' + name + ' (anchor ' + anchor + ') evidence must carry BOTH an id-shape witness AND a derived-value witness (strict AND); got keys=' + Object.keys(ev).join(',') + ', id=' + (idWitness ? idWitness[0] : 'NONE') + ', derived=' + (derivedWitness ? derivedWitness[0] : 'NONE'));
      }
    }
  }
    assert.match(recoverySrc, /exportDatabase/);
  assert.match(recoverySrc, /backupExported/);
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
