// Round G (US-19905): the per-criterion proof level, acceptanceCriterion.proof
// (full | journey | external, optional, absent means full), read by rcf
// audit test-strength, rcf build verdict test, rcf build finalise and rcf
// audit separation (the stage-keeper's rulings 6, 7, 9 and 11).
//
// Criteria here: AC-19905-1 to AC-19905-9 and AC-19905-12, all external.
// Each test drives bin/rcf.js as a child process over a fixture project
// made by the bin's own rcf init, committed to git, in its own scratch
// (mkdtemp under /tmp/rcf-h-). Fixture chains that carry proof are red
// until the rcf-schemas pin carries acceptanceCriterion.proof (the 0.10.0
// schema refuses the field) and the builder reads it; AC-19905-1,
// AC-19905-2 and AC-19905-12 carry no proof and are regression guards,
// green at the round's DEFINE.
//
// AC-19905-1 compares a run with test/cli/fixtures/
// test-strength-proof-absent-0-40-1.json, a test-author fixture (class
// rcfTest) no generator declares. It was generated once at 892bc858
// (rcf-lite 0.40.1, before any round G builder change) by:
//   RCF_PROOF_GOLDEN_WRITE=test/cli/fixtures/test-strength-proof-absent-0-40-1.json \
//     node --test --test-reporter=tap --test-name-pattern='^AC-19905-1:' \
//     test/cli/audit-test-strength-proof.test.js
// from packages/rcf-lite. It is never regenerated: a change that moves
// it is a defect. The fixture's commits carry fixed author and committer
// dates (set below for this file's process; baseEnv passes them through),
// so its head is stable from run to run.
//
// Imports: Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, git, initRepo, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { json, writeTap } from '../_harness/capture.js';

// Fixed commit dates: every fixture commit in this file is reproducible.
process.env.GIT_AUTHOR_DATE = '2026-01-01T00:00:00Z';
process.env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00Z';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'fixtures', 'test-strength-proof-absent-0-40-1.json');
const EXTERNAL_REASON = 'external: proved by the release Verify';
const JOURNEY_REASON = 'journey: no e2e-level bound test';

const CONFIG = { entry: [{ kind: 'bin', path: 'bin/app.js' }], harness: ['test/_harness/**'] };
const L = (...ls) => `${ls.join('\n')}\n`;
const q = JSON.stringify;

// The fixture app (the test/cli/audit-test-strength.test.js shape): a bin
// entry over src/greet.js, its own harness spawning the entry.
const HARNESS = L(
  "import { spawnSync } from 'node:child_process';",
  "import { fileURLToPath } from 'node:url';",
  "const bin = fileURLToPath(new URL('../../bin/app.js', import.meta.url));",
  'export function app(...args) {',
  "  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 20000 });",
  '  return { code: r.status, stdout: r.stdout };',
  '}',
);
const GREET = L(
  'export function greet(name, out) {',
  '  out.push(`hello ${name}`);',
  "  return out.join(' ');",
  '}',
);
const GREET_BIN = L(
  "import { greet } from '../src/greet.js';",
  "process.stdout.write(greet(process.argv[2] ?? 'world', []) + '\\n');",
);
const testFile = (tests, { imports = [] } = {}) => L(
  "import { test } from 'node:test';",
  "import assert from 'node:assert';",
  "import { app } from '../_harness/run.js';",
  ...imports,
  ...tests.flatMap(({ name, body }) => [`test(${q(name)}, () => {`, ...body.map((b) => `  ${b}`), '});']),
);
// A strong test (kills every mutant of greet), a vacuous one (exit code
// only: the no-op and call-removal mutants survive it), and a unit-level
// test importing src/ directly (a structural finding at full).
const STRONG = { name: 'greets ann', body: ["const r = app('ann');", 'assert.strictEqual(r.code, 0);', "assert.strictEqual(r.stdout, 'hello ann\\n');"] };
const VACUOUS = { name: 'runs', body: ["const r = app('ann');", 'assert.strictEqual(r.code, 0);'] };
const UNIT = { name: 'greet unit', body: ["assert.strictEqual(greet('bo', []), 'hello bo');"] };
const BASE = {
  'bin/app.js': GREET_BIN,
  'src/greet.js': GREET,
  'test/_harness/run.js': HARNESS,
  'test/rcf/strong.test.js': testFile([STRONG]),
  'test/rcf/vacuous.test.js': testFile([VACUOUS]),
  'test/unit/greet.test.js': testFile([UNIT], { imports: ["import { greet } from '../../src/greet.js';"] }),
};
const P = {
  strong: `test/rcf/strong.test.js::${STRONG.name}`,
  vacuous: `test/rcf/vacuous.test.js::${VACUOUS.name}`,
  unit: `test/unit/greet.test.js::${UNIT.name}`,
};

function codeNode(dir, n, path, acIds) {
  const id = String(n).padStart(3, '0');
  writeJson(dir, `rcf/code-nodes/cn-${id}.json`, {
    cnId: `CN-${id}`, path, title: `fixture node ${path}`, description: `Fixture Code Node on ${path}.`,
    implementsAcIds: acIds, dependencies: [], version: '0.1.0', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
}

// A test-strength world in git at H: US-101 with `acs` ({ id: extra }, the
// extra fields such as proof or verification on the criterion), FBS-001
// scoping them at inProgress, Code Nodes [[path, acIds]], and bindings
// { e2e: [[acId, pointer]], unit: [[acId, pointer]] } as two suites
// (TS-001 testLevel e2e, TS-002 testLevel unit).
async function world(t, { acs = { 'AC-101-1': {} }, nodes = [['src/greet.js#greet', ['AC-101-1']]], e2e = [['AC-101-1', P.strong]], unit = [] } = {}) {
  const dir = await project(t, { name: 'proof' });
  const ids = Object.keys(acs);
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = ids.map((id) => criterion(id, `${id} holds for the fixture app`, acs[id])); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ids; f.executionStatus = 'inProgress'; });
  for (const [rel, text] of Object.entries(BASE)) writeText(dir, rel, text);
  writeText(dir, 'rcf/test-strength.json', `${q(CONFIG, null, 2)}\n`);
  nodes.forEach(([path, acIdsOf], i) => codeNode(dir, i + 1, path, acIdsOf));
  if (e2e.length) bindTests(dir, e2e.map(([acId, pointer]) => ({ acId, pointer })), { tsId: 'TS-001', testLevel: 'e2e', realTests: false });
  if (unit.length) bindTests(dir, unit.map(([acId, pointer]) => ({ acId, pointer })), { tsId: 'TS-002', testLevel: 'unit', realTests: false });
  // The one init-written field that varies per run (the D0 declaration
  // time) is pinned, so the fixture tree, and with the fixed commit
  // dates its head, is the same on every run.
  writeJson(dir, 'rcf/discovery/journey.json', { ...readJson(dir, 'rcf/discovery/journey.json'), declaredAt: '2026-01-01T00:00:00.000Z' });
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

const strength = (dir, args = []) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: toolPath(['node']) }, timeout: 600_000 });
const out = (r) => r.stdout.replace(/\n$/, '');
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
function reviewed(dir, touchedAcIds) {
  const H = sha(dir);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds }) });
  return H;
}
const passLine = (h, n, structural, totals) => `test-strength: PASS ${n} criteria at ${s7(h)}: structural ${structural}, mutants killed ${totals.killed + totals.timeout}/${totals.mutants - totals.notApplicable} (timeout ${totals.timeout}, notApplicable ${totals.notApplicable})`;

// ---------------------------------------------------------------- ruling 6

// The record text with the two per-run fields masked: wallMs (the run's
// wall time) and node (the running Node version).
const masked = (text) => text.replace(/^ {2}"wallMs": \d+,$/m, '  "wallMs": "<wallMs>",').replace(/^ {2}"node": "[^"]*"$/m, '  "node": "<node>"');

test('AC-19905-1: a chain with no proof on any criterion gives rcf audit test-strength --record the 0.40.1 output byte for byte: the same stdout line, the same exit code and the same record bytes, every field but wallMs and node compared, in the golden test-strength-proof-absent-0-40-1.json', async (t) => {
  const { dir } = await world(t);
  const H = reviewed(dir, ['AC-101-1']);
  const r = await strength(dir, ['--record']);
  const observed = { head: H, code: r.code, stdout: r.stdout, record: masked(readText(dir, verdictPath(H, 'test-strength.json'))) };
  if (process.env.RCF_PROOF_GOLDEN_WRITE) writeFileSync(process.env.RCF_PROOF_GOLDEN_WRITE, `${q(observed, null, 2)}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  assert.equal(observed.head, golden.head, 'given: the fixture head is the golden head (fixed commit dates)');
  assert.equal(observed.stdout, golden.stdout, 'the stdout line is byte-identical');
  assert.equal(observed.code, golden.code, 'the exit code is the same');
  assert.equal(observed.record, golden.record, 'the record bytes are identical but for wallMs and node');
});

// ---------------------------------------------------------------- ruling 7

test('AC-19905-2: a criterion with verification external and no proof is judged at full: with no Code Node rcf audit test-strength exits 4 naming "no Code Node", and with a symbol-level Code Node the mutants run (totals.mutants above 0) and a vacuous bound test fails it', async (t) => {
  const ext = { 'AC-101-1': { verification: 'external' } };
  const a = await world(t, { acs: ext, nodes: [] });
  const ra = await strength(a.dir, ['--acs', 'AC-101-1']);
  assert.equal(ra.code, 4, `${ra.stdout}${ra.stderr}`);
  assert.ok(out(ra).includes('AC-101-1 no Code Node'), `the FAIL line names "AC-101-1 no Code Node"\n${ra.stdout}`);
  const b = await world(t, { acs: ext, e2e: [['AC-101-1', P.vacuous]] });
  const rb = await strength(b.dir, ['--acs', 'AC-101-1', '--json']);
  assert.equal(rb.code, 4, `${rb.stdout}${rb.stderr}`);
  const rep = json(rb.stdout);
  assert.ok(rep.totals.mutants > 0, `the mutants run\n${q(rep.totals)}`);
  assert.equal(crit(rep, 'AC-101-1').result, 'fail');
  assert.ok(!('proof' in crit(rep, 'AC-101-1')), 'no proof field is inferred onto the criterion');
});

// ---------------------------------------------------------------- ruling 9

test('AC-19905-3: a criterion with proof journey bound to an e2e-level test, with a unit-level bound test importing src/ and a Code Node whose mutants that e2e test would let survive, passes: exit 0, the PASS line with structural 1/1 and mutants killed 0/0, and the criterion reads result pass, proof journey, mutants [] and structural pass with no findings', async (t) => {
  const { dir, H } = await world(t, {
    acs: { 'AC-101-1': { proof: 'journey' } }, e2e: [['AC-101-1', P.vacuous]], unit: [['AC-101-1', P.unit]],
  });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rep = json((await strength(dir, ['--acs', 'AC-101-1', '--json'])).stdout);
  assert.equal(rep.totals.mutants, 0, 'no mutant is built or run for a journey criterion');
  assert.equal(out(r), passLine(H, 1, '1/1', rep.totals));
  assert.equal(out(r), `test-strength: PASS 1 criteria at ${s7(H)}: structural 1/1, mutants killed 0/0 (timeout 0, notApplicable 0)`);
  const c = crit(rep, 'AC-101-1');
  assert.deepEqual(Object.keys(c), ['acId', 'proof', 'structural', 'mutants', 'result'], 'the key order: proof directly after acId');
  assert.equal(c.result, 'pass');
  assert.equal(c.proof, 'journey');
  assert.deepEqual(c.mutants, []);
  assert.deepEqual(c.structural, { result: 'pass', findings: [] }, 'the structural check reads the e2e-level bound test only');
  assert.equal(rep.result, 'pass');
});

test('AC-19905-4: a criterion with proof journey whose only bound tests sit in a unit-level suite fails: exit 4, the FAIL line "test-strength: FAIL 1 of 1 criteria at <H7>: AC-101-1 journey: no e2e-level bound test", result fail, proof journey and mutants []', async (t) => {
  const { dir, H } = await world(t, { acs: { 'AC-101-1': { proof: 'journey' } }, e2e: [], unit: [['AC-101-1', P.strong]] });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), `test-strength: FAIL 1 of 1 criteria at ${s7(H)}: AC-101-1 ${JOURNEY_REASON}`);
  const c = crit(json((await strength(dir, ['--acs', 'AC-101-1', '--json'])).stdout), 'AC-101-1');
  assert.equal(c.result, 'fail');
  assert.equal(c.proof, 'journey');
  assert.deepEqual(c.mutants, []);
});

test('AC-19905-5: a criterion with proof external yields result notApplicable with reason "external: proved by the release Verify", no structural check and no mutants, exit 0, totals.criteriaNotApplicable 1, and the PASS line ending "; external 1: AC-101-2 (external: proved by the release Verify)"', async (t) => {
  const { dir, H } = await world(t, {
    acs: { 'AC-101-1': {}, 'AC-101-2': { verification: 'external', proof: 'external' } },
    e2e: [['AC-101-1', P.strong], ['AC-101-2', P.vacuous]],
  });
  const r = await strength(dir, ['--acs', 'AC-101-1,AC-101-2']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rep = json((await strength(dir, ['--acs', 'AC-101-1,AC-101-2', '--json'])).stdout);
  const c = crit(rep, 'AC-101-2');
  assert.deepEqual(Object.keys(c), ['acId', 'proof', 'structural', 'mutants', 'result', 'reason'], 'the key order');
  assert.deepEqual(c, { acId: 'AC-101-2', proof: 'external', structural: { checked: false }, mutants: [], result: 'notApplicable', reason: EXTERNAL_REASON });
  assert.equal(rep.totals.criteria, 2);
  assert.equal(rep.totals.criteriaNotApplicable, 1, 'the summary counts the external criterion');
  assert.equal(rep.result, 'pass');
  assert.equal(out(r), `${passLine(H, 2, '1/1', rep.totals)}; external 1: AC-101-2 (${EXTERNAL_REASON})`);
});

// ---------------------------------------------------------------- ruling 11

test('AC-19905-6: a mix still fails: one full criterion failing plus two external ones under --record exits 4, the line opens "test-strength: FAIL 1 of 3 criteria at <H7>: AC-101-1 vacuous:", the record reads result fail with AC-101-1 fail and AC-101-2 and AC-101-3 notApplicable', async (t) => {
  const ext = { verification: 'external', proof: 'external' };
  const { dir } = await world(t, {
    acs: { 'AC-101-1': {}, 'AC-101-2': ext, 'AC-101-3': ext },
    e2e: [['AC-101-1', P.vacuous], ['AC-101-2', P.strong], ['AC-101-3', P.strong]],
  });
  const H = reviewed(dir, ['AC-101-1', 'AC-101-2', 'AC-101-3']);
  const r = await strength(dir, ['--record']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.ok(out(r).startsWith(`test-strength: FAIL 1 of 3 criteria at ${s7(H)}: AC-101-1 vacuous:`), r.stdout);
  const rec = readJson(dir, verdictPath(H, 'test-strength.json'));
  assert.equal(rec.result, 'fail');
  assert.deepEqual(rec.criteria.map((c) => [c.acId, c.result]), [['AC-101-1', 'fail'], ['AC-101-2', 'notApplicable'], ['AC-101-3', 'notApplicable']]);
});

// ------------------------------------------------- Finalise and the verdict

const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds' };
const BOTH = ['AC-101-1', 'AC-101-2'];
const ptr = (acId) => `test/rcf/a.test.js::${NAMES[acId]}`;

// A round on a feature branch (the test/cli/finalise-verdicts.test.js
// shape): base chain on main with US-101 (AC-101-1, AC-101-2, each with
// `extra` fields), DEFINE: FBS-001 inProgress, BUILD: src/x.js and a
// Code Node per criterion in `cn`, REVIEW: MERGE/PASS touching both,
// TEST: PASS with the test-strength record `strength` (criteria entries).
async function round(t, { extra = {}, cn = BOTH, strength: entries }) {
  const dir = await project(t, { name: 'proof-fin' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = BOTH.map((id) => criterion(id, `[happy] ${NAMES[id]}`, { verification: 'external', ...(extra[id] ?? {}) }));
  });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'notStarted'; });
  bindTests(dir, BOTH.map((acId) => ({ acId, pointer: ptr(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'inProgress'; f.summary = `${f.summary} Round opened.`; });
  commit(dir, 'DEFINE: round');
  const files = { 'src/x.js': 'export function first() { return 1; }\nexport function second() { return 2; }\n' };
  cn.forEach((acId) => {
    const n = acId.slice(-1);
    files[`rcf/code-nodes/cn-00${n}.json`] = {
      cnId: `CN-00${n}`, path: `src/x.js#${n === '1' ? 'first' : 'second'}`, title: `fixture node for ${acId}`, description: `Fixture Code Node implementing ${acId}.`,
      implementsAcIds: [acId], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
  });
  const H = commit(dir, 'BUILD: code', files);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { base: git(dir, 'merge-base', 'main', H), touchedAcIds: BOTH }) });
  commit(dir, 'TEST: verdict', { [verdictPath(H, 'test.json')]: testVerdict(H), [verdictPath(H, 'test-strength.json')]: record(H, entries) });
  return { dir, H };
}
// TestStrengthReport v1 over criteria entries [acId, 'pass' | 'fail' | 'notApplicable' | 'journey'].
function record(head, entries) {
  const criteria = entries.map(([acId, kind]) => {
    if (kind === 'notApplicable') return { acId, proof: 'external', structural: { checked: false }, mutants: [], result: 'notApplicable', reason: EXTERNAL_REASON };
    if (kind === 'journey') return { acId, proof: 'journey', structural: { result: 'pass', findings: [] }, mutants: [], result: 'pass' };
    const ok = kind === 'pass';
    return { acId, structural: { result: 'pass', findings: [] }, mutants: [{ symbol: 'src/x.js#first', operator: 'noOp', result: ok ? 'killed' : 'survived', killedBy: ok ? [ptr(acId)] : [] }], result: ok ? 'pass' : 'fail' };
  });
  const na = criteria.filter((c) => c.result === 'notApplicable').length;
  const graded = criteria.filter((c) => c.mutants.length);
  return {
    version: 1, head, scope: 'reviewVerdict', criteria, result: criteria.some((c) => c.result === 'fail') ? 'fail' : 'pass',
    totals: { criteria: criteria.length, structuralPassed: criteria.length - na, mutants: graded.length, killed: graded.filter((c) => c.result === 'pass').length, survived: graded.filter((c) => c.result === 'fail').length, timeout: 0, notApplicable: 0, blocked: 0, ...(na ? { criteriaNotApplicable: na } : {}) },
    wallMs: 10, node: process.version,
  };
}
const finalise = (dir) => rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });
const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\n${r.stdout}${r.stderr}`);
const status = (dir) => readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus;

test('AC-19905-7: rcf build finalise accepts a record whose touched set is pass (AC-101-1, full) plus notApplicable (AC-101-2, proof external), writing complete with exit 0, and refuses with exit 4 "finalise refused: test-strength at <H7> fails for AC-101-1" when the full criterion fails beside the notApplicable one', async (t) => {
  const ext = { 'AC-101-2': { proof: 'external' } };
  const a = await round(t, { extra: ext, cn: ['AC-101-1'], strength: [['AC-101-1', 'pass'], ['AC-101-2', 'notApplicable']] });
  const ra = await finalise(a.dir);
  assert.equal(ra.code, 0, `${ra.stdout}${ra.stderr}`);
  assert.equal(status(a.dir), 'complete');
  const b = await round(t, { extra: ext, cn: ['AC-101-1'], strength: [['AC-101-1', 'fail'], ['AC-101-2', 'notApplicable']] });
  const rb = await finalise(b.dir);
  assert.equal(rb.code, 4, `${rb.stdout}${rb.stderr}`);
  errHas(rb, `finalise refused: test-strength at ${s7(b.H)} fails for AC-101-1`);
  assert.equal(status(b.dir), 'inProgress');
});

test('AC-19905-8: rcf build finalise requires no Code Node on a journey or an external criterion and still requires one on a full criterion: with AC-101-1 proof journey and AC-101-2 proof external, neither with a Code Node, it exits 0; with AC-101-1 full (proof absent) and no Code Node it exits 3 "finalise refused: missing Code Node for AC-101-1"', async (t) => {
  const a = await round(t, { extra: { 'AC-101-1': { proof: 'journey' }, 'AC-101-2': { proof: 'external' } }, cn: [], strength: [['AC-101-1', 'journey'], ['AC-101-2', 'notApplicable']] });
  const ra = await finalise(a.dir);
  assert.equal(ra.code, 0, `${ra.stdout}${ra.stderr}`);
  assert.equal(status(a.dir), 'complete');
  const b = await round(t, { extra: { 'AC-101-2': { proof: 'external' } }, cn: [], strength: [['AC-101-1', 'pass'], ['AC-101-2', 'notApplicable']] });
  const rb = await finalise(b.dir);
  assert.equal(rb.code, 3, `${rb.stdout}${rb.stderr}`);
  errHas(rb, 'finalise refused: missing Code Node for AC-101-1');
});

// The Test verdict world (the test/cli/build-verdict-rounds.test.js shape):
// base chain, a BUILD: commit H and a REVIEW: MERGE/PASS touching both.
async function verdictRound(t, extra) {
  const dir = await project(t, { name: 'proof-verdict' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = BOTH.map((id) => criterion(id, `[happy] ${NAMES[id]}`, extra[id] ?? {})); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'inProgress'; });
  bindTests(dir, BOTH.map((acId) => ({ acId, pointer: ptr(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  const H = commit(dir, 'BUILD: code', { 'src/x.js': 'export const x = 1;\n' });
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { base: git(dir, 'merge-base', 'main', H), touchedAcIds: BOTH }) });
  return { dir, H };
}
const tapOf = (t, names) => writeTap(join(scratch(t, 'rcf-h-tap-'), 'suite.tap'), [...names.map((name) => ({ name })), { name: 'other test 1' }]);
const verdictTest = (dir, tap) => rcf(['build', 'verdict', 'test', '--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap, '--runtime', 'fixture app'], { cwd: dir });

test('AC-19905-9: rcf build verdict test --result PASS passes (exit 0, test.json written) when the bound test of an external-level criterion is absent from the TAP, and still refuses with exit 4 "verdict refused: the TAP summary does not include bound test <pointer> of AC-101-1" when the bound test of a full-level criterion is absent', async (t) => {
  const a = await verdictRound(t, { 'AC-101-2': { verification: 'external', proof: 'external' } });
  const ra = await verdictTest(a.dir, tapOf(t, [NAMES['AC-101-1']]));
  assert.equal(ra.code, 0, `${ra.stdout}${ra.stderr}`);
  assert.equal(readJson(a.dir, verdictPath(a.H, 'test.json')).result, 'PASS');
  const b = await verdictRound(t, { 'AC-101-1': { proof: 'full' }, 'AC-101-2': { verification: 'external', proof: 'external' } });
  const rb = await verdictTest(b.dir, tapOf(t, [NAMES['AC-101-2']]));
  assert.equal(rb.code, 4, `${rb.stdout}${rb.stderr}`);
  errHas(rb, `verdict refused: the TAP summary does not include bound test ${ptr('AC-101-1')} of AC-101-1`);
});

// ---------------------------------------------------------------- separation

test('AC-19905-12: rcf audit separation is unchanged on a round whose test-strength record carries a notApplicable criterion: over DEFINE:, BUILD:, REVIEW: and TEST: commits it exits 0 with the line "separation: PASS 4 commits (base <b7>, head <h7>): DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 0, merges 0, transition 0"', async (t) => {
  const { dir } = await round(t, { cn: ['AC-101-1'], strength: [['AC-101-1', 'pass'], ['AC-101-2', 'notApplicable']] });
  const base = sha(dir, 'main');
  const head = sha(dir);
  const r = await rcf(['audit', 'separation', '--base', 'main', '--head', 'HEAD'], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), `separation: PASS 4 commits (base ${s7(base)}, head ${s7(head)}): DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 0, merges 0, transition 0`);
});
