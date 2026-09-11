// Anatomy + shape + probe-shape + fixture + shelf-doc test for the
// object-storage-s3 v1.1.0 shelf blueprint (round-7 follow-up spec
// section 5.4; v1.0.0 anatomy per infra round 5 spec section 5.2).
// Covers TS-071 (v1.0.0 shape) plus additive assertions for the
// v1.1.0 Hetzner Object Storage adapter delta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.equal(doc.version, '1.2.3');
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
  // object-store.mjs (TAC-2901 facade) is the sole reader of @aws-sdk/client-s3
  const storeSrc = await readFile(join(FIXTURE_ROOT, 'src', 'object-store.mjs'), 'utf8');
  assert.match(storeSrc, /from ['"]@aws-sdk\/client-s3['"]/,
    'src/object-store.mjs must import @aws-sdk/client-s3');
  // 7d conformance: the object-storage-s3 pack's Declared env vars
  // table names the first-tier gates plus every second-tier variable
  // each real-account probe reads. Section header is register-neutral
  // (no work-item lane label).
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
  // Anatomy check on 7d evidence shape: every object-storage-s3 probe
  // module attaches an evidence bag on its result rows or records an
  // accountBoundSkipped honest skip (authoring standard section 7d,
  // authoring-standard rule 3 of 2026-09-11; per-row rule of the 2026-09-11
  // follow-up review). When a run record is present under
  // `.rcf/reports/blueprints/<slug>/<probe>.json`, EVERY result row is
  // validated in-place.
  for (const name of [
    'facade-round-trip', 'put-get-round-trip', 'presigned-url',
    'multipart-upload', 'event-secrecy', 'r2-real-account-smoke',
    'hetzner-object-storage-round-trip',
  ]) {
    const src = await readFile(join(REPO_ROOT, 'blueprints', 'object-storage-s3', 'contributions', 'probes', `${name}.mjs`), 'utf8');
    // Source-level per-row check: every `results.push({` opens a block
    // that must carry either `evidence:` or `accountBoundSkipped:`
    // before its closing `});`. A single file-level `evidence:` token
    // no longer satisfies the check (closure3 concern: file-level
    // regex fallback accepted probes whose other rows carried no
    // evidence).
    const pushOpens = [...src.matchAll(/results\.push\(\s*\{/g)];
    for (const opener of pushOpens) {
      const start = opener.index;
      let depth = 1;
      let i = opener.index + opener[0].length;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        i += 1;
      }
      const block = src.slice(start, i);
      assert.ok(/evidence\s*:/.test(block) || /accountBoundSkipped\s*:\s*true/.test(block) || /conformanceOnly\s*:\s*true/.test(block),
        `probe ${name}.mjs: results.push at offset ${start} must carry evidence, accountBoundSkipped:true, or conformanceOnly:true (7d per-row rule)`);
    }
    const reportPath = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'object-storage-s3', `${name}.json`);
    try {
      const raw = await readFile(reportPath, 'utf8');
      const rep = JSON.parse(raw);
      assert.ok(Array.isArray(rep.results) && rep.results.length > 0,
        `run record ${name}.json must carry a non-empty results[] (authoring-standard rule 3)`);
      for (const row of rep.results) {
        assert.ok(['pass', 'warn', 'fail'].includes(row.verdict),
          `row in ${name}.json must have verdict in {pass, warn, fail}, saw ${row.verdict}`);
        const anchor = row.anchorAcId ?? row.anchorReqId;
        const declaimed = row.conformanceOnly === true;
        if (!declaimed) {
          assert.ok(typeof anchor === 'string' && anchor.length > 0,
            `every non-conformanceOnly row in ${name}.json must anchor an AC or REQ`);
          assert.notEqual(anchor, 'unknown', `row in ${name}.json anchors "unknown" (authoring-standard rule 1)`);
        } else {
          assert.equal(row.anchorAcId, null,
            `conformanceOnly row in ${name}.json must set anchorAcId: null`);
          assert.ok(typeof row.limitation === 'string' && /(REQ|AC)-/.test(row.limitation),
            `conformanceOnly row in ${name}.json must carry a limitation naming a shipped AC or REQ`);
        }
        const skipOk = row.accountBoundSkipped === true && typeof row.reason === 'string' && / unset$| \(not "true"\)$/.test(row.reason);
        const ev = row.evidence;
        const evOk = ev && typeof ev === 'object' && Object.keys(ev).length > 0;
        // Strict per-row 7d shape: for a non-skip row, evidence must
        // carry AT LEAST ONE key that looks like a 7d witness (request
        // id, response body/derived value, inventory diff, or process
        // record). A bare `reason` string never counts.
        // 7d witness: a request id, a status/http code, a
        // body/derived value, an inventory-diff or event-record key,
        // or a process-level observation. Bare admin strings
        // (`reason`, `note`, `error`, `verdict`) do not count.
        const trivialAdminKeys = new Set(['reason', 'note', 'error', 'verdict', 'skip']);
        function isWitness(k, v) {
          if (trivialAdminKeys.has(k)) return false;
          if (v == null) return false;
          if (typeof v === 'string' && v.length === 0) return false;
          if (Array.isArray(v) && v.length === 0) return false;
          return true;
        }
        if (skipOk) {
          assert.ok(evOk && (ev.skip === true || Object.keys(ev).some((k) => isWitness(k, ev[k]))),
            `skip row in ${name}.json (anchor ${anchor}) must carry a non-empty evidence object`);
        } else {
          assert.ok(evOk,
            `non-skip row in ${name}.json (anchor ${anchor ?? 'conformanceOnly'}) must carry a non-empty evidence object`);
          const witnessKeys = Object.entries(ev).filter(([k, v]) => isWitness(k, v)).map(([k]) => k);
          assert.ok(witnessKeys.length > 0,
            `non-skip row in ${name}.json (anchor ${anchor ?? 'conformanceOnly'}) evidence must carry at least one 7d witness key (non-admin, non-empty); got keys=${Object.keys(ev).join(',')}`);
        }
      }
      assert.equal(rep.aggregateVerdict, 'pass',
        `run record ${name}.json aggregateVerdict must be pass, saw ${rep.aggregateVerdict}`);
    } catch (err) {
      if (err.code !== 'ENOENT' && !err.message.includes('no such file')) throw err;
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
