// Anatomy + shape + probe-shape + fixture + shelf-doc test for the
// object-storage-s3 v1.1.0 shelf blueprint (round-7 follow-up spec
// section 5.4; v1.0.0 anatomy per infra round 5 spec section 5.2).
// Covers TS-071 (v1.0.0 shape) plus additive assertions for the
// v1.1.0 Hetzner Object Storage adapter delta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'object-storage-s3');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const AUTHORING_DOC = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

test('blueprint.json declares 25 contributions at v1.1.0 with capabilities objectStorage, suggestedCompanions logging and errorHandling, and standardsTraceClause on every ADR entry including the Hetzner Object Storage provider entry (TC-071-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'object-storage-s3');
  // v1.1.0 follow-up (round-7 spec section 5.4) additive minor bump:
  // v1.0.0 shipped 21 contributions (6 REQ, 8 US, 3 TAC, 4 ADR);
  // v1.1.0 adds 4 delta contributions (1 REQ, 1 US, 1 TAC, 1 ADR)
  // for the Hetzner Object Storage adapter (total 25).
  assert.equal(doc.version, '1.2.9');
  assert.equal(doc.category, 'object-storage');
  assert.deepEqual(doc.capabilities, ['objectStorage']);
  assert.equal(doc.contributions.length, 25);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 7);
  assert.equal(kinds.us, 9);
  assert.equal(kinds.tac, 4);
  assert.equal(kinds.adr, 5);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  for (const adr of adrs) {
    assert.ok(typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0,
      `ADR entry ${adr.id} must carry a non-null standardsTraceClause per section 8a.2`);
  }
  const globalAdrs = adrs.filter((a) => a.scope === 'global');
  assert.equal(globalAdrs.length, 1);
  assert.equal(globalAdrs[0].topic, 'objectStorageContract');
  // v1.1.0 delta assertions: the four new contribution ids are present
  // and every v1.0.0 shipped id remains untouched.
  const ids = new Set(doc.contributions.map((c) => c.id));
  for (const id of [
    'object-storage-s3-REQ-101',
    'object-storage-s3-US-28110',
    'TAC-2904-object-storage-s3-hetzner-endpoint-helper',
    'ADR-2905-object-storage-s3-hetzner-object-storage-provider',
  ]) {
    assert.ok(ids.has(id), `v1.1.0 delta contribution ${id} must be present`);
  }
  const shippedV100Ids = [
    'object-storage-s3-REQ-001', 'object-storage-s3-REQ-002', 'object-storage-s3-REQ-003',
    'object-storage-s3-REQ-004', 'object-storage-s3-REQ-005', 'object-storage-s3-REQ-006',
    'object-storage-s3-US-28101', 'object-storage-s3-US-28102', 'object-storage-s3-US-28103',
    'object-storage-s3-US-28104', 'object-storage-s3-US-28105', 'object-storage-s3-US-28106',
    'object-storage-s3-US-28107', 'object-storage-s3-US-28108',
    'TAC-2901-object-storage-s3-facade', 'TAC-2902-object-storage-s3-multipart-uploader',
    'TAC-2903-object-storage-s3-event-sink',
    'ADR-2901-object-storage-s3-adapter', 'ADR-2902-object-storage-s3-presigned-ttl-floor',
    'ADR-2903-object-storage-s3-multipart-threshold', 'ADR-2904-object-storage-s3-contract',
  ];
  for (const id of shippedV100Ids) {
    assert.ok(ids.has(id), `v1.0.0 contribution ${id} must remain present after the additive v1.1.0 bump`);
  }
  const hetznerAdr = adrs.find((a) => a.id === 'ADR-2905-object-storage-s3-hetzner-object-storage-provider');
  assert.equal(hetznerAdr.standardsTraceClause, 'Hetzner Object Storage S3 compatibility documented endpoint shape');
});

test('apply object-storage-s3 refuses on a bare fixture without security-secrets-management and lands with --allow-no-secrets-yet (TC-071-apply-refusal-and-override)', async () => {
  // The compose-time refusal AC (AC-4101-3) is enforced via the T-5
  // capability mechanism (visual round spec 5.5.1) as folded into this
  // train by coordinator ruling: security-secrets-management v1.0.1
  // declares capabilities: ["secretsProvider"], and object-storage-s3
  // declares requiresAppliedCapabilities with allowSkipFlag
  // "allow-no-secrets-yet" and refusalMessageId
  // "object-storage-s3-no-secrets". The apply verb refuses on a bare
  // project with exit 3 and stderr carrying [object-storage-s3-no-secrets];
  // the --allow-no-secrets-yet override records a notes line on
  // rcf/blueprints/object-storage-s3.applied.json.
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.ok(doc.requiresAppliedCapabilities,
    'per infra round 5 spec 5.2 (Baz decision 6) and coordinator fold-in ruling, object-storage-s3 declares requiresAppliedCapabilities via the T-5 mechanism');
  assert.deepEqual(doc.requiresAppliedCapabilities.capabilities, ['secretsProvider']);
  assert.equal(doc.requiresAppliedCapabilities.allowSkipFlag, 'allow-no-secrets-yet');
  assert.equal(doc.requiresAppliedCapabilities.refusalMessageId, 'object-storage-s3-no-secrets');
  const readme = await readFile(join(BLUEPRINT_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /object-storage-s3-no-secrets/,
    'blueprint README must name the stable message id');
  assert.match(readme, /--allow-no-secrets-yet/,
    'blueprint README must name the override flag');
});

test('apply object-storage-s3 lands 21 contributions on a scratch project with security-secrets-management applied (TC-071-applies-clean-with-secrets)', async () => {
  // Full apply verified end-to-end at the gate via `rcf define blueprint
  // add` against a scratch project. This unit test asserts the blueprint's
  // 21 contribution files exist at the paths declared in blueprint.json so
  // the shipped shelf is loadable.
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  for (const c of doc.contributions) {
    const filePath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const s = await stat(filePath);
    assert.ok(s.isFile(), `contribution file ${c.path} must exist`);
    const body = JSON.parse(await readFile(filePath, 'utf8'));
    if (c.kind === 'req') assert.equal(body.reqId, c.id);
    if (c.kind === 'us') assert.equal(body.usId, c.id);
    if (c.kind === 'tac') assert.equal(body.tacId, c.id);
    if (c.kind === 'adr') assert.equal(body.adrId, c.id);
  }
});

test('every probe module exports the section 3.2 verdict envelope with an anchorAcId matching a contributed AC id (TC-071-probe-anchor-ids-cross-check)', async () => {
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
  const probeNames = [
    'facade-round-trip',
    'put-get-round-trip',
    'presigned-url',
    'multipart-upload',
    'event-secrecy',
    'r2-real-account-smoke',
  ];
  for (const name of probeNames) {
    const probePath = join(PROBES_DIR, `${name}.mjs`);
    const stats = await stat(probePath);
    assert.ok(stats.isFile(), `probe module ${name}.mjs must exist`);
    const shimPath = join(PROBES_DIR, `run-${name}.mjs`);
    const shimStats = await stat(shimPath);
    assert.ok(shimStats.isFile(), `probe shim run-${name}.mjs must exist`);
    const src = await readFile(probePath, 'utf8');
    const anchors = [...src.matchAll(/anchorAcId:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    assert.ok(anchors.length > 0, `probe ${name} must reference at least one anchorAcId literal`);
    for (const anchor of anchors) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} anchorAcId ${anchor} must match a contributed AC id (contributed=${[...contributedAcIds].join(',')})`);
    }
  }
  // r2-real-account-smoke declares accountBound: true per spec section 3.5
  const r2Src = await readFile(join(PROBES_DIR, 'r2-real-account-smoke.mjs'), 'utf8');
  assert.match(r2Src, /export const accountBound = true/,
    'r2-real-account-smoke must declare accountBound: true');
});

test('sample-app fixture ships docker-compose.yml, package.json, src/object-store.mjs, src/secrets.mjs, and its README documents docker and podman and the four wired induced-failure switches (TC-071-fixture-and-switches)', async () => {
  await stat(join(FIXTURE_ROOT, 'docker-compose.yml'));
  await stat(join(FIXTURE_ROOT, 'package.json'));
  await stat(join(FIXTURE_ROOT, 'src', 'object-store.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'secrets.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'create-bucket.mjs'));
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const sw of [
    'SIMULATE_MINIO_DOWN',
    'SIMULATE_403_ON_GET',
    'SIMULATE_PART_UPLOAD_FAIL',
    'SIMULATE_PRESIGN_MALFORMED',
  ]) {
    assert.match(readme, new RegExp(sw), `fixture README must document ${sw}`);
  }
  // SIMULATE_PII_ON_EVENT and SIMULATE_LARGE_PAYLOAD were removed at
  // v1.0.0: the event-secrecy whitelist is code-enforced and the
  // 10 MiB multipart probe already exercises the above-threshold path.
  assert.doesNotMatch(readme, /SIMULATE_PII_ON_EVENT/,
    'unwired switches must not appear in the fixture README (doc-truth)');
  assert.doesNotMatch(readme, /SIMULATE_LARGE_PAYLOAD/,
    'unwired switches must not appear in the fixture README (doc-truth)');
  assert.match(readme, /minio\/minio/);
  assert.match(readme, /podman/i);
  // object-store.mjs (TAC-2901 facade) is the sole reader of
  // @aws-sdk/client-s3. Match either the retired static `from
  // '@aws-sdk/client-s3'` or the lazy `await import('@aws-sdk/client-s3')`
  // inside createObjectStore per the maintainer's 2026-09-11
  // lazy-load ruling.
  const storeSrc = await readFile(join(FIXTURE_ROOT, 'src', 'object-store.mjs'), 'utf8');
  assert.match(storeSrc,
    /(?:from ['"]@aws-sdk\/client-s3['"]|import\(['"]@aws-sdk\/client-s3['"]\))/,
    'src/object-store.mjs must import @aws-sdk/client-s3');
  // 7d conformance: the object-storage-s3 pack's Declared env vars
  // table names the first-tier gates plus every second-tier variable
  // each real-account probe reads. Section header is register-neutral.
  assert.match(readme, /^## Declared env vars \(object-storage-s3 pack\)/m);
  for (const v of [
    'S3_ENDPOINT_URL', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'CI_HAS_CLOUDFLARE_ACCOUNT', 'R2_ACCOUNT_ID', 'R2_BUCKET',
    'CI_HAS_HETZNER_OBJECT_STORAGE',
    'HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID', 'HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'HETZNER_OBJECT_STORAGE_BUCKET', 'HETZNER_OBJECT_STORAGE_LOCATION',
  ]) {
    assert.match(readme, new RegExp(`\`${v}\``), `Declared env vars must name ${v}`);
  }
  // R2 and Hetzner real-account probes carry DECLARED_ENV exports and
  // record the skip reason naming the exact unset variable.
  const r2Src = await readFile(join(REPO_ROOT, 'blueprints', 'object-storage-s3', 'contributions', 'probes', 'r2-real-account-smoke.mjs'), 'utf8');
  assert.match(r2Src, /export const DECLARED_ENV/, 'r2-real-account-smoke must export DECLARED_ENV');
  assert.match(r2Src, /accountBoundSkipped: true/);
  assert.match(r2Src, /reason/);
  const hetznerSrc = await readFile(join(REPO_ROOT, 'blueprints', 'object-storage-s3', 'contributions', 'probes', 'hetzner-object-storage-round-trip.mjs'), 'utf8');
  assert.match(hetznerSrc, /export const DECLARED_ENV/, 'hetzner-object-storage-round-trip must export DECLARED_ENV');
  assert.match(hetznerSrc, /accountBoundSkipped: true/);
  assert.match(hetznerSrc, /reason/);
  // Anatomy check on 7d evidence shape (STRICT rewrite): each probe
  // is invoked directly and its returned result set is validated
  // in-memory (round-8 ruling: the anatomy owns the invocation, the
  // probe owns its skip; the pre-round-8 `.rcf/reports/blueprints`
  // record path is no longer read on this seam). EVERY row is
  // validated against one of four shapes:
  //   (a) a real observation carrying `evidence` with BOTH an id-shape
  //       witness AND a derived-value witness (strict AND, never OR);
  //   (b) `conformanceOnly: true` with `anchorAcId: null` and a
  //       `limitation` string that names at least one shipped AC id;
  //   (c) `notObservableHere: { ac, reason }` naming a shipped AC id;
  //   (d) `accountBoundSkipped: true` with a `reason` string that names
  //       exactly one env var declared on the probe's `DECLARED_ENV`
  //       list.
  const usDir = join(REPO_ROOT, 'blueprints', 'object-storage-s3', 'contributions', 'user-stories');
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
  // Round-8 ruling: a counting row's identifier is a value the ENGINE
  // RETURNED for that operation. Postgres row ids / serials, the
  // migration version the migrations table reports, pg_backend_pid()
  // and transaction ids the server returned. S3 / R2 return the
  // ETag, VersionId, UploadId and `x-amz-request-id` (surfaced as
  // `$metadata.requestId`). Cloudflare Queues return queue id,
  // message id and request id. The jobs scheduler mints jobId.
  // Scratch names the probe chose, database names, migration
  // filenames, checksums the probe computed and any array are NOT
  // identifiers.
  const STRICT_ID_KEYS = new Set([
    // http request / metadata ids the engine returned
    'requestId',
    'vendorRequestId',
    // S3 / R2 object identifiers returned by the engine
    'eTag', 'versionId', 'uploadId',
    // Cloudflare Queues identifiers returned by the API
    'queueId', 'messageId',
    // jobs scheduler identifiers
    'jobId',
    // Postgres identifiers the server returned
    'rowId', 'insertedId', 'backendPid', 'transactionId',
    'migrationVersion',
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
    const src = await readFile(join(REPO_ROOT, 'blueprints', 'object-storage-s3', 'contributions', 'probes', `${probeName}.mjs`), 'utf8');
    const m = src.match(/DECLARED_ENV\s*=\s*Object\.freeze\(\[([^\]]+)\]\s*\)/);
    if (!m) return null;
    return new Set([...m[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((x) => x[1]));
  }
  const probeNamesLocal = ["facade-round-trip","put-get-round-trip","presigned-url","multipart-upload","event-secrecy","r2-real-account-smoke","hetzner-object-storage-round-trip"];
  // Round-7 ruling: the probe owns its skip. The anatomy ALWAYS
  // invokes every probe and validates whatever comes back. A CI
  // environment with S3_ENDPOINT_URL unset lands the five local
  // probes on the exact-one-variable accountBoundSkipped row emitted
  // by the fixture helper's MissingS3EndpointError; the two
  // account-bound probes (R2, Hetzner) return their own
  // exact-one-variable skips against CI_HAS_CLOUDFLARE_ACCOUNT and
  // CI_HAS_HETZNER_OBJECT_STORAGE respectively. Locally with MinIO
  // and real accounts up the probes run live.
  for (const name of probeNamesLocal) {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, name + '.mjs')).href)).default;
    const declaredEnv = await loadDeclaredEnv(name);
    let probeReturn;
    try {
      probeReturn = await runProbe();
    } catch (err) {
      assert.fail(name + ': probe threw ' + (err && err.code ? err.code : err && err.message ? err.message : String(err)));
    }
    const rows = Array.isArray(probeReturn) ? probeReturn : (probeReturn && Array.isArray(probeReturn.results) ? probeReturn.results : null);
    assert.ok(rows && rows.length > 0,
      name + ': runProbe must return a non-empty results array');
    probeReturn = { results: rows };
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
        // The derived witness must not be the same key as the id
        // witness - the round-8 ruling requires DISTINCT fields, and a
        // key such as `observedUploadId` legitimately matches both
        // STRICT_ID_KEYS and the /^observed/ derived pattern.
        const derivedWitness = Object.entries(ev).find(([k, v]) => (!idWitness || k !== idWitness[0]) && isDerivedWitness(k, v));
        assert.ok(idWitness && derivedWitness,
          'non-declaimed row in ' + name + ' (anchor ' + anchor + ') evidence must carry BOTH an id-shape witness AND a derived-value witness');

        assert.notEqual(idWitness[0], derivedWitness[0],
          'non-declaimed row in ' + name + ' (anchor ' + anchor + ') idWitness and derivedWitness must be DIFFERENT fields (round-8 ruling); got both under key ' + idWitness[0]);      }
    }
  }
});

test('section 6a table gains an objectStorage row and every shipped blueprint docs/topics.md gains an object-storage-s3 row at 28101-28899 / 29xx (TC-071-shelf-doc-consistency)', async () => {
  const authoring = await readFile(AUTHORING_DOC, 'utf8');
  assert.match(authoring, /^\|\s*`objectStorage`\s*\|/m,
    'section 6a capability table must gain an objectStorage row');
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
        /^\|\s*object-storage-s3\s*\|\s*28101-28899\s*\|\s*29xx\s*\|/m,
        `${bp}/docs/topics.md must carry an object-storage-s3 row at 28101-28899 / 29xx`,
      );
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }
});

// TC-071-skip-shape-negative: synthetic assertion that the R2 and Hetzner
// non-"true" skip reasons emitted by the two account-bound probes
// (`r2-real-account-smoke.mjs`, `hetzner-object-storage-round-trip.mjs`)
// parse to a bare declared env-var name under the anatomy's exact
// accepted regex; the malformed pre-pass-13 shape `<VAR> set to "..." (not "true")`
// is rejected. This keeps the S3 anatomy's negative-case coverage
// aligned with the jobs anatomy's own skip-shape negative block.
test('anatomy accountBoundSkipped reason parses R2 and Hetzner non-"true" shapes to the same env var (TC-071-skip-shape-negative)', () => {
  const strip = /^([A-Z][A-Z0-9_]+)(?: unset| \(not "true"\))$/;
  const declared = new Set([
    'S3_ENDPOINT_URL',
    'CI_HAS_CLOUDFLARE_ACCOUNT', 'R2_ACCOUNT_ID', 'R2_BUCKET',
    'CI_HAS_HETZNER_OBJECT_STORAGE',
  ]);
  const cases = [
    { reason: 'CI_HAS_CLOUDFLARE_ACCOUNT unset', expected: 'CI_HAS_CLOUDFLARE_ACCOUNT' },
    { reason: 'CI_HAS_CLOUDFLARE_ACCOUNT (not "true")', expected: 'CI_HAS_CLOUDFLARE_ACCOUNT' },
    { reason: 'CI_HAS_HETZNER_OBJECT_STORAGE unset', expected: 'CI_HAS_HETZNER_OBJECT_STORAGE' },
    { reason: 'CI_HAS_HETZNER_OBJECT_STORAGE (not "true")', expected: 'CI_HAS_HETZNER_OBJECT_STORAGE' },
    { reason: 'S3_ENDPOINT_URL unset', expected: 'S3_ENDPOINT_URL' },
  ];
  for (const c of cases) {
    const m = c.reason.match(strip);
    assert.ok(m, 'reason ' + JSON.stringify(c.reason) + ' must parse as <VAR> unset or <VAR> (not "true")');
    assert.equal(m[1], c.expected, 'stripped var name must be ' + c.expected);
    assert.ok(declared.has(m[1]), 'stripped var name must be a declared env var');
    assert.match(c.reason, / unset$| \(not "true"\)$/, 'anatomy suffix regex must match');
    const stripped = c.reason.replace(/ unset$| \(not "true"\)$/, '').trim();
    assert.equal(stripped, c.expected, 'anatomy suffix strip must yield the bare var name');
  }
  // Negative cases: shapes the anatomy MUST reject. The first two are
  // the exact malformed pre-pass-13 R2 and Hetzner emissions.
  const rejects = [
    'CI_HAS_CLOUDFLARE_ACCOUNT set to "1" (not "true")',
    'CI_HAS_HETZNER_OBJECT_STORAGE set to "yes" (not "true")',
    'CI_HAS_CLOUDFLARE_ACCOUNT was empty',
    'CI_HAS_CLOUDFLARE_ACCOUNT and R2_BUCKET unset',
    'invalid',
  ];
  for (const bad of rejects) {
    let stripped = null;
    if (/ unset$| \(not "true"\)$/.test(bad)) {
      stripped = bad.replace(/ unset$| \(not "true"\)$/, '').trim();
    }
    const parsesToBareVar = stripped != null && /^[A-Z][A-Z0-9_]+$/.test(stripped);
    assert.equal(parsesToBareVar, false, 'anatomy MUST reject ' + JSON.stringify(bad));
  }
});
