// Dogfood tree integrity tests. Validates every JSON file under rcf/
// against @stravica-ai/rcf-schemas@0.2.0 and asserts the referential
// integrity that D7 walker + D8 validator enforce structurally.
//
// Phase 3.7 shape (D1-D6, D14):
//   Every parent-child edge is encoded on the child. PRD no longer carries
//   requirementIds; each REQ carries prdId. TAD no longer carries
//   componentIds / architecturalDecisionIds; each TAC / ADR carries tadId.
//   BS no longer carries fbs[]; each FBS carries bsId + buildOrder +
//   executionStatus + dependsOnFbsIds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Schemas registered as a bundle so cross-file $refs resolve.
import commonSchema from '@stravica-ai/rcf-schemas/schemas/common.schema.json' with { type: 'json' };
import prdSchema from '@stravica-ai/rcf-schemas/schemas/prd.schema.json' with { type: 'json' };
import reqSchema from '@stravica-ai/rcf-schemas/schemas/req.schema.json' with { type: 'json' };
import userStorySchema from '@stravica-ai/rcf-schemas/schemas/user-story.schema.json' with { type: 'json' };
import tadSchema from '@stravica-ai/rcf-schemas/schemas/tad.schema.json' with { type: 'json' };
import tacSchema from '@stravica-ai/rcf-schemas/schemas/tac.schema.json' with { type: 'json' };
import adrSchema from '@stravica-ai/rcf-schemas/schemas/adr.schema.json' with { type: 'json' };
import buildSequenceSchema from '@stravica-ai/rcf-schemas/schemas/build-sequence.schema.json' with { type: 'json' };
import fbsSchema from '@stravica-ai/rcf-schemas/schemas/fbs.schema.json' with { type: 'json' };
import testSuiteSchema from '@stravica-ai/rcf-schemas/schemas/test-suite.schema.json' with { type: 'json' };
import manifestSchema from '@stravica-ai/rcf-schemas/schemas/manifest.schema.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const rcfRoot = resolve(repoRoot, 'rcf');

function buildAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(commonSchema);
  ajv.addSchema(prdSchema);
  ajv.addSchema(reqSchema);
  ajv.addSchema(userStorySchema);
  ajv.addSchema(tadSchema);
  ajv.addSchema(tacSchema);
  ajv.addSchema(adrSchema);
  ajv.addSchema(buildSequenceSchema);
  ajv.addSchema(fbsSchema);
  ajv.addSchema(testSuiteSchema);
  ajv.addSchema(manifestSchema);
  return ajv;
}

const schemaIdByKind = {
  manifest: manifestSchema.$id,
  prd: prdSchema.$id,
  req: reqSchema.$id,
  userStory: userStorySchema.$id,
  tad: tadSchema.$id,
  tac: tacSchema.$id,
  adr: adrSchema.$id,
  buildSequence: buildSequenceSchema.$id,
  fbs: fbsSchema.$id,
  testSuite: testSuiteSchema.$id,
};

function classify(relPath) {
  if (relPath === 'manifest.json') return 'manifest';
  if (relPath === 'prd.json') return 'prd';
  if (relPath === 'tad.json') return 'tad';
  if (relPath === 'build-sequence.json') return 'buildSequence';
  if (relPath.startsWith('requirements/')) return 'req';
  if (relPath.startsWith('user-stories/')) return 'userStory';
  if (relPath.startsWith('tacs/')) return 'tac';
  if (relPath.startsWith('adrs/')) return 'adr';
  if (relPath.startsWith('fbs/')) return 'fbs';
  if (relPath.startsWith('test-suites/')) return 'testSuite';
  return null;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.json')) acc.push(full);
  }
  return acc;
}

function loadAll() {
  const files = walk(rcfRoot).sort();
  return files.map((full) => {
    const rel = relative(rcfRoot, full).split('\\').join('/');
    const kind = classify(rel);
    const json = JSON.parse(readFileSync(full, 'utf8'));
    return { full, rel, kind, json };
  });
}

const expectedCounts = {
  manifest: 1,
  prd: 1,
  req: 7,
  userStory: 19,
  tad: 1,
  tac: 7,
  adr: 5,
  buildSequence: 1,
  fbs: 12,
};

test('expected file counts by category', () => {
  const docs = loadAll();
  const counts = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  for (const [kind, expected] of Object.entries(expectedCounts)) {
    assert.equal(
      counts[kind] ?? 0,
      expected,
      `expected ${expected} ${kind} files, found ${counts[kind] ?? 0}`,
    );
  }
});

test('every document classifies to a known schema', () => {
  const docs = loadAll();
  for (const d of docs) {
    assert.ok(d.kind !== null, `unclassified file: ${d.rel}`);
    assert.ok(schemaIdByKind[d.kind], `no schema mapped for kind: ${d.kind}`);
  }
});

test('every document validates against its @stravica-ai/rcf-schemas@0.2.0 schema', () => {
  const ajv = buildAjv();
  const docs = loadAll();
  const failures = [];
  for (const d of docs) {
    const validate = ajv.getSchema(schemaIdByKind[d.kind]);
    assert.ok(validate, `compiled schema missing for ${d.kind}`);
    if (!validate(d.json)) {
      failures.push({ file: d.rel, errors: validate.errors });
    }
  }
  assert.equal(
    failures.length,
    0,
    `validation failures:\n${JSON.stringify(failures, null, 2)}`,
  );
});

test('file id matches filename and structural location', () => {
  const docs = loadAll();
  const idField = {
    prd: 'prdId',
    req: 'reqId',
    userStory: 'usId',
    tad: 'tadId',
    tac: 'tacId',
    adr: 'adrId',
    buildSequence: 'bsId',
    fbs: 'fbsId',
    testSuite: 'id',
  };
  for (const d of docs) {
    if (d.kind === 'manifest') continue;
    const field = idField[d.kind];
    const id = d.json[field];
    assert.ok(id, `${d.rel} missing ${field}`);
    if (d.kind === 'prd' || d.kind === 'tad' || d.kind === 'buildSequence') continue;
    const stem = d.rel.split('/').pop().replace(/\.json$/, '');
    assert.equal(stem, id.toLowerCase(), `${d.rel} filename does not match id ${id}`);
  }
});

test('PRD no longer carries removed requirementIds field (D2)', () => {
  const docs = loadAll();
  const prd = docs.find((d) => d.kind === 'prd').json;
  assert.equal('requirementIds' in prd, false, 'PRD still carries removed requirementIds field');
});

test('TAD no longer carries removed componentIds / architecturalDecisionIds fields (D2)', () => {
  const docs = loadAll();
  const tad = docs.find((d) => d.kind === 'tad').json;
  assert.equal('componentIds' in tad, false);
  assert.equal('architecturalDecisionIds' in tad, false);
});

test('BS no longer carries removed fbs[] array (D6)', () => {
  const docs = loadAll();
  const bs = docs.find((d) => d.kind === 'buildSequence').json;
  assert.equal('fbs' in bs, false);
});

test('every REQ carries prdId matching the PRD (child-owned parent edge, D1)', () => {
  const docs = loadAll();
  const prdId = docs.find((d) => d.kind === 'prd').json.prdId;
  const reqs = docs.filter((d) => d.kind === 'req').map((d) => d.json);
  for (const r of reqs) {
    assert.equal(r.prdId, prdId, `REQ ${r.reqId} has wrong prdId`);
  }
});

test('every TAC and ADR carries tadId matching the TAD (D1)', () => {
  const docs = loadAll();
  const tadId = docs.find((d) => d.kind === 'tad').json.tadId;
  for (const t of docs.filter((d) => d.kind === 'tac')) {
    assert.equal(t.json.tadId, tadId, `TAC ${t.json.tacId} has wrong tadId`);
  }
  for (const a of docs.filter((d) => d.kind === 'adr')) {
    assert.equal(a.json.tadId, tadId, `ADR ${a.json.adrId} has wrong tadId`);
  }
});

test('every US has at least one covering REQ (US.reqId resolves)', () => {
  const docs = loadAll();
  const reqIds = new Set(docs.filter((d) => d.kind === 'req').map((d) => d.json.reqId));
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const reqToUs = {};
  for (const us of usDocs) {
    assert.ok(reqIds.has(us.reqId), `US ${us.usId} references unknown REQ ${us.reqId}`);
    (reqToUs[us.reqId] ??= []).push(us.usId);
  }
  for (const reqId of reqIds) {
    assert.ok(reqToUs[reqId]?.length, `REQ ${reqId} has no user stories`);
  }
});

test('every FBS carries bsId + buildOrder + executionStatus + dependsOnFbsIds (D6)', () => {
  const docs = loadAll();
  const bsId = docs.find((d) => d.kind === 'buildSequence').json.bsId;
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const fbsIds = new Set(fbsDocs.map((f) => f.fbsId));
  const orders = new Set();
  for (const f of fbsDocs) {
    assert.equal(f.bsId, bsId, `FBS ${f.fbsId} has wrong bsId`);
    assert.equal(typeof f.buildOrder, 'number', `FBS ${f.fbsId} missing buildOrder`);
    assert.ok(f.executionStatus, `FBS ${f.fbsId} missing executionStatus`);
    assert.ok(Array.isArray(f.dependsOnFbsIds), `FBS ${f.fbsId} missing dependsOnFbsIds`);
    for (const dep of f.dependsOnFbsIds) {
      assert.ok(fbsIds.has(dep), `FBS ${f.fbsId} depends on unknown FBS ${dep}`);
      assert.notEqual(dep, f.fbsId, `FBS ${f.fbsId} depends on itself`);
    }
    assert.equal(orders.has(f.buildOrder), false, `duplicate buildOrder ${f.buildOrder} inside ${bsId}`);
    orders.add(f.buildOrder);
  }
});

test('every FBS acId resolves to a real AC and every AC is covered by at least one FBS', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) {
      assert.ok(!acIds.has(ac.id), `duplicate AC id ${ac.id} across user stories`);
      acIds.add(ac.id);
      const m = ac.id.match(/^AC-(\d{3,})-\d+$/);
      if (m) {
        const usNum = us.usId.match(/^US-(\d{3,})$/)?.[1];
        assert.equal(m[1], usNum, `AC ${ac.id} sits under US-${usNum} but its prefix is ${m[1]}`);
      }
    }
  }
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const tacIds = new Set(docs.filter((d) => d.kind === 'tac').map((d) => d.json.tacId));
  const adrIds = new Set(docs.filter((d) => d.kind === 'adr').map((d) => d.json.adrId));
  const covered = new Set();
  for (const f of fbsDocs) {
    for (const acId of f.acIds) {
      assert.ok(acIds.has(acId), `FBS ${f.fbsId} references unknown AC ${acId}`);
      covered.add(acId);
    }
    const ctx = f.contextRequirements ?? {};
    for (const tacId of ctx.tacIds ?? []) {
      assert.ok(tacIds.has(tacId), `FBS ${f.fbsId} references unknown TAC ${tacId}`);
    }
    for (const adrId of ctx.adrIds ?? []) {
      assert.ok(adrIds.has(adrId), `FBS ${f.fbsId} references unknown ADR ${adrId}`);
    }
  }
  const orphans = [...acIds].filter((id) => !covered.has(id)).sort();
  assert.equal(orphans.length, 0, `acceptance criteria not covered by any FBS: ${orphans.join(', ')}`);
});

test('manifest roots resolve to existing files with matching ids', () => {
  const docs = loadAll();
  const manifest = docs.find((d) => d.kind === 'manifest').json;
  const prdDoc = docs.find((d) => d.kind === 'prd');
  const tadDoc = docs.find((d) => d.kind === 'tad');
  const bsDoc = docs.find((d) => d.kind === 'buildSequence');
  assert.equal(manifest.prd.id, prdDoc.json.prdId);
  assert.equal(manifest.tad.id, tadDoc.json.tadId);
  assert.equal(manifest.bs.id, bsDoc.json.bsId);
});
