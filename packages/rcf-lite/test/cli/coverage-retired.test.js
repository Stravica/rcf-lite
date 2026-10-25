// FBS-228 (US-19401): retired criteria (supersededBy) in rcf audit coverage and rcf audit eval coverage (AC-19401-5 to -11).
//
// One test per criterion, bound by the US-19401 test suite (TS-260); the
// test names are the declarations' names, so every TS-260 pointer still
// resolves. Each is a node:test todo case ("FBS-228 round DEFINE", GR-35):
// it runs and is red until FBS-228's round DEFINE drops the marker and
// BUILD turns it green. US-19401's criteria predate the 0.37.0 flag, so
// they carry no verification tag; they drive bin/rcf.js over fixture
// chains. The fixture project is made by the bin's own rcf init (which
// runs initProject) in a scratch directory with the claude-free PATH pin,
// through test/_harness/ (GR-40); its chain records are then shaped by
// writing their JSON. AC-19401-12's test stays in
// test/verify/probe-assertion-0-9-0.test.js (FBS-228's notes).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rcf } from '../_harness/spawn.js';
import { bindTests, criterion, editFbs, editStory, project, writeJson } from '../_harness/fixture.js';
import { json } from '../_harness/capture.js';

const RETIRED = { supersededOn: '2026-10-20', supersessionNote: 'replaced by AC-101-2' };

// US-101 holds exactly `acs`; FBS-001 scopes them all.
async function world(t, acs) {
  const dir = await project(t, { name: 'retired' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs; });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs.map((a) => a.id); });
  return dir;
}

function acRow(body, acId) {
  for (const r of body.requirements) for (const a of r.acs ?? []) if (a.id === acId) return { req: r, ac: a };
  return null;
}

// The table row of one criterion: the line naming it in the AC column.
function tableRow(stdout, acId) {
  return stdout.split('\n').find((l) => new RegExp(`(^|\\s)${acId}\\s`).test(l)) ?? '';
}

test('AC-19401-5: rcf audit coverage with AC-101-1 superseded by AC-101-2 (no TC) and AC-101-2 bound to a resolving TC exits 0, the row reads "retired (AC-101-2)", json state "retired" supersededBy "AC-101-2" covered false totals.retiredAcs 1, mermaid "AC-101-1 -. supersededBy .-> AC-101-2", shallow-any exits 0', async (t) => {
  const dir = await world(t, [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-2', ...RETIRED }),
    criterion('AC-101-2', '[happy] the replacement behaviour'),
  ]);
  bindTests(dir, [{ acId: 'AC-101-2', pointer: 'test/rcf/a.test.js::replacement holds' }]);

  const table = await rcf(['audit', 'coverage'], { cwd: dir });
  assert.equal(table.code, 0, `strict coverage exits 0\n${table.stdout}${table.stderr}`);
  assert.match(table.stdout, /^REQ-001\s+yes\b/m, 'REQ-001 reads covered');
  assert.match(tableRow(table.stdout, 'AC-101-1'), /AC-101-1\s+retired \(AC-101-2\)/, 'the AC-101-1 row reads "retired (AC-101-2)" in the AC covered column');

  const j = await rcf(['audit', 'coverage', '--format', 'json'], { cwd: dir });
  assert.equal(j.code, 0);
  const body = json(j.stdout);
  const { ac } = acRow(body, 'AC-101-1');
  assert.equal(ac.state, 'retired');
  assert.equal(ac.supersededBy, 'AC-101-2');
  assert.equal(ac.covered, false);
  assert.equal(body.totals.retiredAcs, 1);

  const mmd = await rcf(['audit', 'coverage', '--format', 'mermaid'], { cwd: dir });
  assert.ok(mmd.stdout.includes('AC-101-1 -. supersededBy .-> AC-101-2'), `mermaid carries the supersession edge\n${mmd.stdout}`);

  const shallow = await rcf(['audit', 'coverage', '--mode', 'shallow-any'], { cwd: dir });
  assert.equal(shallow.code, 0);
  assert.match(tableRow(shallow.stdout, 'AC-101-1'), /AC-101-1\s+retired \(AC-101-2\)/, 'shallow-any prints the same retired row');
});

// For the three supersession errors the live criterion is bound, so the
// only cause of a strict exit 4 is the supersession line.
async function supersessionError(t, acs, line) {
  const dir = await world(t, acs);
  const live = acs.filter((a) => !a.supersededBy);
  const cases = live.map((a, i) => ({ acId: a.id, pointer: `test/rcf/a.test.js::live ${i + 1}` }));
  if (live.length === 0) {
    // Both US-101 criteria are retired: a second story under REQ-001
    // carries the live, bound criterion that keeps REQ-001 covered.
    writeJson(dir, 'rcf/user-stories/us-102.json', {
      usId: 'US-102', prdId: 'PRD-001', reqId: 'REQ-001', version: '0.1.0', status: 'draft',
      title: 'A second story', asA: 'user', iWant: 'a live criterion', soThat: 'REQ-001 has one',
      acceptanceCriteria: [criterion('AC-102-1', '[happy] the live behaviour')],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    bindTests(dir, [{ acId: 'AC-102-1', pointer: 'test/rcf/b.test.js::live b' }], { tsId: 'TS-002', usId: 'US-102' });
  } else {
    bindTests(dir, cases);
  }
  const strict = await rcf(['audit', 'coverage'], { cwd: dir });
  assert.equal(strict.code, 4, `strict coverage exits 4\n${strict.stdout}${strict.stderr}`);
  assert.ok(strict.stdout.split('\n').includes(line), `stdout carries the line ${JSON.stringify(line)}\n${strict.stdout}`);
  const shallow = await rcf(['audit', 'coverage', '--mode', 'shallow-any'], { cwd: dir });
  assert.ok(shallow.stdout.split('\n').includes(line), `shallow-any prints the same line\n${shallow.stdout}`);
  assert.equal(shallow.code, 0, `shallow-any exits 0\n${shallow.stdout}${shallow.stderr}`);
  const validate = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(validate.code, 0, `define validate exits 0 on the same chain\n${validate.stdout}${validate.stderr}`);
  return strict;
}

test('AC-19401-6: rcf audit coverage with AC-101-1 supersededBy AC-101-9 absent from the chain exits 4 printing "supersession: AC-101-1 supersededBy AC-101-9: successor not found in the chain"; --mode shallow-any prints it and exits 0; rcf define validate exits 0', async (t) => {
  await supersessionError(t, [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-9', ...RETIRED, supersessionNote: 'replaced by AC-101-9' }),
    criterion('AC-101-2', '[happy] another behaviour'),
  ], 'supersession: AC-101-1 supersededBy AC-101-9: successor not found in the chain');
});

test('AC-19401-7: rcf audit coverage with AC-101-1 supersededBy AC-101-1 exits 4 printing "supersession: AC-101-1 supersededBy AC-101-1: a criterion cannot supersede itself"; --mode shallow-any prints it and exits 0; rcf define validate exits 0', async (t) => {
  await supersessionError(t, [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-1', ...RETIRED, supersessionNote: 'replaced by itself' }),
    criterion('AC-101-2', '[happy] another behaviour'),
  ], 'supersession: AC-101-1 supersededBy AC-101-1: a criterion cannot supersede itself');
});

test('AC-19401-8: rcf audit coverage with AC-101-1 and AC-101-2 superseding each other exits 4 printing one line "supersession: AC-101-1 supersededBy AC-101-2: cycle AC-101-1 -> AC-101-2 -> AC-101-1"; --mode shallow-any prints it and exits 0; rcf define validate exits 0', async (t) => {
  const line = 'supersession: AC-101-1 supersededBy AC-101-2: cycle AC-101-1 -> AC-101-2 -> AC-101-1';
  const strict = await supersessionError(t, [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-2', ...RETIRED }),
    criterion('AC-101-2', '[happy] the second behaviour', { supersededBy: 'AC-101-1', ...RETIRED, supersessionNote: 'replaced by AC-101-1' }),
  ], line);
  const cycleLines = strict.stdout.split('\n').filter((l) => l.startsWith('supersession:') && l.includes('cycle'));
  assert.deepEqual(cycleLines, [line], 'exactly one line for the cycle, starting at the lowest id');
});

test('AC-19401-9: rcf audit coverage with a resolving TC still bound to retired AC-101-1 and no TC on AC-101-2 exits 4 with REQ-001 uncovered; the AC-101-1 row reads "retired (AC-101-2)" and lists the TC, json keeps it in testCases, and it counts toward nothing', async (t) => {
  const dir = await world(t, [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-2', ...RETIRED }),
    criterion('AC-101-2', '[happy] the replacement behaviour'),
  ]);
  const tc1 = 'TC-001-retired-binding';
  bindTests(dir, [{ acId: 'AC-101-1', tcId: tc1, pointer: 'test/rcf/a.test.js::old binding' }]);

  const table = await rcf(['audit', 'coverage'], { cwd: dir });
  assert.equal(table.code, 4);
  assert.match(table.stdout, /^REQ-001\s+no\b/m, 'REQ-001 reads uncovered');
  const row = tableRow(table.stdout, 'AC-101-1');
  assert.match(row, /AC-101-1\s+retired \(AC-101-2\)/);
  assert.ok(row.includes(tc1), `the AC-101-1 row still lists ${tc1} in its Test cases column\n${row}`);

  const j = await rcf(['audit', 'coverage', '--format', 'json'], { cwd: dir });
  const body = json(j.stdout);
  const one = acRow(body, 'AC-101-1');
  assert.equal(one.ac.state, 'retired');
  assert.deepEqual(one.ac.testCases, [tc1]);
  assert.equal(one.req.covered, false, 'TC-1 is not counted toward REQ-001');
  const two = acRow(body, 'AC-101-2');
  assert.equal(two.ac.covered, false, 'TC-1 is not counted toward AC-101-2');
  assert.deepEqual(two.ac.testCases, []);
});

test('AC-19401-10: rcf audit coverage with retired AC-101-1, covered AC-101-2 and uncovered AC-101-3 exits 4 with REQ-001 uncovered and AC-101-3 "no"; AC-101-1 never reads "yes" or covered true in strict or shallow-any mode', async (t) => {
  const acs = [
    criterion('AC-101-1', '[happy] the first behaviour', { supersededBy: 'AC-101-2', ...RETIRED }),
    criterion('AC-101-2', '[happy] the replacement behaviour'),
    criterion('AC-101-3', '[happy] a third behaviour'),
  ];
  const dir = await world(t, acs);
  bindTests(dir, [{ acId: 'AC-101-2', pointer: 'test/rcf/a.test.js::replacement holds' }]);

  const strict = await rcf(['audit', 'coverage'], { cwd: dir });
  assert.equal(strict.code, 4);
  assert.match(strict.stdout, /^REQ-001\s+no\b/m, 'REQ-001 reads uncovered');
  assert.match(tableRow(strict.stdout, 'AC-101-3'), /AC-101-3\s+no\b/, 'the AC-101-3 row reads "no"');
  for (const mode of [[], ['--mode', 'shallow-any']]) {
    const tbl = await rcf(['audit', 'coverage', ...mode], { cwd: dir });
    assert.doesNotMatch(tableRow(tbl.stdout, 'AC-101-1'), /AC-101-1\s+yes\b/, `AC-101-1 never reads "yes" (${mode.join(' ') || 'strict'})`);
    const j = json((await rcf(['audit', 'coverage', ...mode, '--format', 'json'], { cwd: dir })).stdout);
    assert.notEqual(acRow(j, 'AC-101-1').ac.covered, true, `AC-101-1 is never covered true (${mode.join(' ') || 'strict'})`);
  }

  // totals.covered never counts a requirement on the strength of a
  // retired criterion: the same chain whose only resolving binding is on
  // AC-101-1 counts no requirement covered in either mode.
  const only = await world(t, acs);
  bindTests(only, [{ acId: 'AC-101-1', pointer: 'test/rcf/a.test.js::old binding' }]);
  for (const mode of [[], ['--mode', 'shallow-any']]) {
    const j = json((await rcf(['audit', 'coverage', ...mode, '--format', 'json'], { cwd: only })).stdout);
    assert.equal(j.totals.covered, 0, `no requirement counted covered on a retired criterion (${mode.join(' ') || 'strict'})`);
  }
});

function evalDoc(id, acIds) {
  return {
    id, usId: 'US-101', acIds, title: `${id} fixture eval`, purpose: 'fixture',
    criteria: [{ id: 'shape', description: 'the output has the declared shape', critical: true }],
    cases: [{ id: 'one', input: { prompt: 'x' } }],
    judge: { type: 'rubric' }, passThreshold: { aggregateScore: 0.8, criticalMustPass: true },
    runRecord: [{ runId: '2026-10-20T00:00:00Z-fixture', runAt: '2026-10-20T00:00:00Z', runner: 'fixture', aggregateScore: 1, criticalFailures: [], perCaseScores: [{ caseId: 'one', score: 1 }], verdict: 'pass' }],
    status: 'approved', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  };
}

test('AC-19401-11: rcf audit eval coverage --strict with retired nonDeterministic AC-101-1 and no EVAL exits 0 reading outcome "retired" supersededBy "AC-101-2" and missingCount 0; a live nonDeterministic AC-101-3 with no EVAL still reads "missing" and exits 4', async (t) => {
  const base = [
    criterion('AC-101-1', '[happy] the first behaviour', { determinism: 'nonDeterministic', supersededBy: 'AC-101-2', ...RETIRED }),
    criterion('AC-101-2', '[happy] the replacement behaviour', { determinism: 'nonDeterministic' }),
  ];
  const dir = await world(t, base);
  writeJson(dir, 'rcf/evals/eval-001.json', evalDoc('EVAL-001', ['AC-101-2']));
  const r = await rcf(['audit', 'eval', 'coverage', '--strict', '--format', 'json'], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const body = json(r.stdout);
  const one = body.acs.find((a) => a.acId === 'AC-101-1');
  assert.equal(one.outcome, 'retired', 'never "missing"');
  assert.equal(one.supersededBy, 'AC-101-2');
  assert.equal(body.missingCount, 0);

  const third = await world(t, [...base, criterion('AC-101-3', '[happy] a third behaviour', { determinism: 'nonDeterministic' })]);
  writeJson(third, 'rcf/evals/eval-001.json', evalDoc('EVAL-001', ['AC-101-2']));
  const r3 = await rcf(['audit', 'eval', 'coverage', '--strict', '--format', 'json'], { cwd: third });
  assert.equal(r3.code, 4);
  assert.equal(json(r3.stdout).acs.find((a) => a.acId === 'AC-101-3').outcome, 'missing');
});
