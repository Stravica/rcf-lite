import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Schemas registered as a bundle so cross-file $refs resolve.
import commonSchema from '@stravica/rcf-schemas/schemas/common.schema.json' with { type: 'json' };
import prdSchema from '@stravica/rcf-schemas/schemas/prd.schema.json' with { type: 'json' };
import reqSchema from '@stravica/rcf-schemas/schemas/req.schema.json' with { type: 'json' };
import userStorySchema from '@stravica/rcf-schemas/schemas/user-story.schema.json' with { type: 'json' };
import tadSchema from '@stravica/rcf-schemas/schemas/tad.schema.json' with { type: 'json' };
import tacSchema from '@stravica/rcf-schemas/schemas/tac.schema.json' with { type: 'json' };
import adrSchema from '@stravica/rcf-schemas/schemas/adr.schema.json' with { type: 'json' };
import buildSequenceSchema from '@stravica/rcf-schemas/schemas/build-sequence.schema.json' with { type: 'json' };
import fbsSchema from '@stravica/rcf-schemas/schemas/fbs.schema.json' with { type: 'json' };
import manifestSchema from '@stravica/rcf-schemas/schemas/manifest.schema.json' with { type: 'json' };

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
  const total = docs.length;
  const expectedTotal = Object.values(expectedCounts).reduce((a, b) => a + b, 0);
  assert.equal(total, expectedTotal, `expected ${expectedTotal} files, found ${total}`);
});

test('every document classifies to a known schema', () => {
  const docs = loadAll();
  for (const d of docs) {
    assert.ok(d.kind !== null, `unclassified file: ${d.rel}`);
    assert.ok(schemaIdByKind[d.kind], `no schema mapped for kind: ${d.kind}`);
  }
});

test('every document validates against its schema', () => {
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
  };
  for (const d of docs) {
    if (d.kind === 'manifest') continue;
    const field = idField[d.kind];
    const id = d.json[field];
    assert.ok(id, `${d.rel} missing ${field}`);
    if (d.kind === 'prd' || d.kind === 'tad' || d.kind === 'buildSequence') continue;
    // For per-doc files, the filename stem should match the lower-cased id.
    const stem = d.rel.split('/').pop().replace(/\.json$/, '');
    assert.equal(stem, id.toLowerCase(), `${d.rel} filename does not match id ${id}`);
  }
});

test('referential integrity: PRD requirementIds match REQ files', () => {
  const docs = loadAll();
  const prd = docs.find((d) => d.kind === 'prd').json;
  const reqIds = new Set(docs.filter((d) => d.kind === 'req').map((d) => d.json.reqId));
  for (const id of prd.requirementIds) {
    assert.ok(reqIds.has(id), `PRD lists REQ ${id} but no req file exists`);
  }
  for (const id of reqIds) {
    assert.ok(prd.requirementIds.includes(id), `REQ ${id} exists but PRD does not list it`);
  }
});

test('referential integrity: every REQ has at least one US, every US claims a real REQ', () => {
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

test('referential integrity: TAD componentIds match TAC files; TAD architecturalDecisionIds match ADR files', () => {
  const docs = loadAll();
  const tad = docs.find((d) => d.kind === 'tad').json;
  const tacIds = new Set(docs.filter((d) => d.kind === 'tac').map((d) => d.json.tacId));
  const adrIds = new Set(docs.filter((d) => d.kind === 'adr').map((d) => d.json.adrId));
  for (const id of tad.componentIds) {
    assert.ok(tacIds.has(id), `TAD lists TAC ${id} but no TAC file exists`);
  }
  for (const id of tacIds) {
    assert.ok(tad.componentIds.includes(id), `TAC ${id} exists but TAD does not list it`);
  }
  for (const id of tad.architecturalDecisionIds) {
    assert.ok(adrIds.has(id), `TAD lists ADR ${id} but no ADR file exists`);
  }
  for (const id of adrIds) {
    assert.ok(tad.architecturalDecisionIds.includes(id), `ADR ${id} exists but TAD does not list it`);
  }
});

test('referential integrity: BS references FBS-001..N in order; FBS dependencies and contextRequirements resolve', () => {
  const docs = loadAll();
  const bs = docs.find((d) => d.kind === 'buildSequence').json;
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const fbsIds = new Set(fbsDocs.map((f) => f.fbsId));
  const tacIds = new Set(docs.filter((d) => d.kind === 'tac').map((d) => d.json.tacId));
  const adrIds = new Set(docs.filter((d) => d.kind === 'adr').map((d) => d.json.adrId));
  // Every slot id has a file; every fbs file is in the BS; orders are unique.
  const slotIds = bs.fbs.map((s) => s.fbsId);
  const orders = bs.fbs.map((s) => s.order);
  assert.equal(new Set(orders).size, orders.length, 'BS slot orders are not unique');
  for (const id of slotIds) assert.ok(fbsIds.has(id), `BS slot references missing FBS ${id}`);
  for (const id of fbsIds) assert.ok(slotIds.includes(id), `FBS ${id} not listed in BS`);
  // FBS dependencies resolve to real FBS ids.
  for (const f of fbsDocs) {
    for (const dep of f.dependencies ?? []) {
      assert.ok(fbsIds.has(dep), `FBS ${f.fbsId} depends on unknown FBS ${dep}`);
      assert.notEqual(dep, f.fbsId, `FBS ${f.fbsId} depends on itself`);
    }
    const ctx = f.contextRequirements ?? {};
    for (const tacId of ctx.tacIds ?? []) {
      assert.ok(tacIds.has(tacId), `FBS ${f.fbsId} references unknown TAC ${tacId}`);
    }
    for (const adrId of ctx.adrIds ?? []) {
      assert.ok(adrIds.has(adrId), `FBS ${f.fbsId} references unknown ADR ${adrId}`);
    }
  }
});

test('referential integrity: every FBS acId resolves to a real acceptance criterion under a US', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  const acToUs = {};
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) {
      assert.ok(!acIds.has(ac.id), `duplicate AC id ${ac.id} across user stories`);
      acIds.add(ac.id);
      acToUs[ac.id] = us.usId;
      // Hierarchical AC ids must agree with their parent US number.
      const m = ac.id.match(/^AC-(\d{3,})-\d+$/);
      if (m) {
        const usNum = us.usId.match(/^US-(\d{3,})$/)?.[1];
        assert.equal(m[1], usNum, `AC ${ac.id} sits under US-${usNum} but its prefix is ${m[1]}`);
      }
    }
  }
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  for (const f of fbsDocs) {
    for (const acId of f.acIds) {
      assert.ok(acIds.has(acId), `FBS ${f.fbsId} references unknown AC ${acId}`);
    }
  }
});

test('referential integrity: every AC is covered by at least one FBS', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const allAcIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) allAcIds.add(ac.id);
  }
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const covered = new Set();
  for (const f of fbsDocs) {
    for (const acId of f.acIds) covered.add(acId);
  }
  const orphans = [...allAcIds].filter((id) => !covered.has(id)).sort();
  assert.equal(
    orphans.length,
    0,
    `acceptance criteria not covered by any FBS: ${orphans.join(', ')}`,
  );
});

test('referential integrity: manifest roots resolve to existing files with matching ids', () => {
  const docs = loadAll();
  const manifest = docs.find((d) => d.kind === 'manifest').json;
  const prdDoc = docs.find((d) => d.kind === 'prd');
  const tadDoc = docs.find((d) => d.kind === 'tad');
  const bsDoc = docs.find((d) => d.kind === 'buildSequence');
  assert.equal(manifest.prd.id, prdDoc.json.prdId);
  assert.equal(manifest.tad.id, tadDoc.json.tadId);
  assert.equal(manifest.bs.id, bsDoc.json.bsId);
  assert.equal(manifest.prd.path, 'prd.json');
  assert.equal(manifest.tad.path, 'tad.json');
  assert.equal(manifest.bs.path, 'build-sequence.json');
});

test('referential integrity: ADR and TAC parent ids match the TAD and PRD', () => {
  const docs = loadAll();
  const tad = docs.find((d) => d.kind === 'tad').json;
  const prd = docs.find((d) => d.kind === 'prd').json;
  for (const d of docs.filter((d) => d.kind === 'tac')) {
    assert.equal(d.json.tadId, tad.tadId, `TAC ${d.json.tacId} has wrong tadId`);
    assert.equal(d.json.prdId, prd.prdId, `TAC ${d.json.tacId} has wrong prdId`);
  }
  for (const d of docs.filter((d) => d.kind === 'adr')) {
    assert.equal(d.json.tadId, tad.tadId, `ADR ${d.json.adrId} has wrong tadId`);
    assert.equal(d.json.prdId, prd.prdId, `ADR ${d.json.adrId} has wrong prdId`);
  }
});

test('referential integrity: REQ, US, FBS, BS all claim the correct prdId', () => {
  const docs = loadAll();
  const prdId = docs.find((d) => d.kind === 'prd').json.prdId;
  const bsId = docs.find((d) => d.kind === 'buildSequence').json.bsId;
  for (const d of docs.filter((d) => d.kind === 'req')) {
    assert.equal(d.json.prdId, prdId, `REQ ${d.json.reqId} has wrong prdId`);
  }
  for (const d of docs.filter((d) => d.kind === 'userStory')) {
    assert.equal(d.json.prdId, prdId, `US ${d.json.usId} has wrong prdId`);
  }
  for (const d of docs.filter((d) => d.kind === 'fbs')) {
    assert.equal(d.json.prdId, prdId, `FBS ${d.json.fbsId} has wrong prdId`);
    assert.equal(d.json.bsId, bsId, `FBS ${d.json.fbsId} has wrong bsId`);
  }
});
