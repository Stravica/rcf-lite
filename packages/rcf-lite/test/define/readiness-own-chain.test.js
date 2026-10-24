// FBS-240 (US-20301, US-20302, US-20303): readiness D1 to D6 and D8 green
// on this repository's own chain, frozen --next again, every failing check
// cleared by chain records, and the operator's two D1 profile answers.
//
// Criteria: 11, all testOnly (US-20301 4, US-20302 4, US-20303 3).
// Tested here: 11. AC-20301-4 compares the Chips line over the named
// readiness fixture trees under test/fixtures/readiness/ with the chip
// golden test/fixtures/readiness/chips.json, both of which FBS-240's
// round DEFINE commits, the golden captured from the round-base bin with
// node test/_harness/goldens.js readiness-chips test/fixtures/readiness/chips.json
// (the stage-keeper's ruling 8 on the Part B summary's stops, reading b in
// golden form). Its own-chain half and AC-20302-3 compare against the
// own-chain golden test/fixtures/own-chain/at-639f07bb.json, which
// FBS-240's round DEFINE records from a full clone with
// node test/_harness/goldens.js own-chain test/fixtures/own-chain/at-639f07bb.json
// (the stage-keeper's ruling on part B3's open question 1, reading a), so
// neither reads git history. No test in this file reads git history beyond
// HEAD (the stage-keeper's rule on the independent check), except
// AC-20303-3, which stays as at 136c51e5: its rewrite under ruling F3 is
// stopped and returned to the stage-keeper as a question.
//
// Every test is a node:test todo case ("FBS-240 round DEFINE", GR-35): it
// runs and is red until FBS-240's round DEFINE drops the marker. Each
// reads this repository through RCF_CHECKOUT when it is set, else from
// this file's location (GR-34), and asserts at the current head ("this
// slice's reviewed head or any later head", section 8.1
// readiness-at-slice-head), so it is red today by design. A test that
// needs a scratch copy copies the package's rcf/ and test/ trees and
// package.json into a scratch git repository and runs the bin there: rcf
// define freeze and record changes run only inside that copy, never on
// the checkout. The timing test prints the host facts (GR-45). The two
// profile answers are the operator's input (GR-55), collected before
// FBS-240's round DEFINE records them: the US-20303 tests read whichever
// answers are recorded and never presume them. Imports: Node builtins and
// test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, gitTry, initRepo, sha } from '../_harness/git.js';
import { baseSuiteRecord, checkoutPackage, checkoutRoot, scratch, writeJson } from '../_harness/fixture.js';
import { hostFacts, json } from '../_harness/capture.js';
import { MAIN_0361, readinessChips, readinessTrees } from '../_harness/goldens.js';

const TODO = { todo: 'FBS-240 round DEFINE' };
const PROFILE = 'rcf/.identity/profile.md';

const pkg = () => checkoutPackage();
const readiness = (cwd, args) => rcf(['define', 'readiness', ...args], { cwd });
const readinessJson = async (cwd, args = []) => json((await readiness(cwd, ['--json', ...args])).stdout);
const stageOf = (doc, gate) => doc.stages.find((s) => s.gate === gate || s.stage === gate);

// A scratch copy of the package chain (rcf/, test/, package.json) as its own
// git repository on main, built once per file and copied per test.
let template = null;
function copyTemplate() {
  if (template) return template;
  const dir = join(scratch(null, 'rcf-h-own-'), 'pkg');
  mkdirSync(dir, { recursive: true });
  for (const part of ['rcf', 'test', 'package.json']) cpSync(join(pkg(), part), join(dir, part), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: a scratch copy of the chain at the current head');
  template = dir;
  return dir;
}
function scratchCopy(t) {
  const dir = join(scratch(t, 'rcf-h-copy-'), 'pkg');
  cpSync(copyTemplate(), dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------- US-20301

test('AC-20301-1: at the current head node bin/rcf.js define readiness --check all from packages/rcf-lite exits 0, its Chips line reads D0:notApplicable and D1 to D8 passed, and it prints "Freezeable: yes"', TODO, async () => {
  const r = await readiness(pkg(), ['--check', 'all']);
  assert.equal(r.code, 0, `${r.stdout.slice(0, 3000)}${r.stderr.slice(-1000)}`);
  assert.ok(lines(r.stdout).includes('Chips: D0:notApplicable D1:passed D2:passed D3:passed D4:passed D5:passed D6:passed D7:passed D8:passed'), `the Chips line\n${lines(r.stdout).find((l) => l.startsWith('Chips:'))}`);
  assert.ok(lines(r.stdout).some((l) => l.startsWith('Freezeable: yes')), `prints "Freezeable: yes"\n${lines(r.stdout).find((l) => l.startsWith('Freezeable:'))}`);
});

test('AC-20301-2: in a scratch copy at the current head with the freeze recorded by define freeze, build bundle --next --base-suite <a green record for that head> exits 0 without --override and emits the next bundle, and readiness no longer prints "Unfrozen"', TODO, async (t) => {
  const dir = scratchCopy(t);
  const f = await rcf(['define', 'freeze'], { cwd: dir });
  assert.equal(f.code, 0, `define freeze records the freeze in the copy\n${f.stdout.slice(0, 2000)}${f.stderr.slice(-1500)}`);
  const recDir = scratch(t, 'rcf-h-base-');
  writeJson(recDir, 'base.json', baseSuiteRecord(sha(dir)));
  const b = await rcf(['build', 'bundle', '--next', '--base-suite', join(recDir, 'base.json')], { cwd: dir });
  assert.equal(b.code, 0, `${b.stdout.slice(0, 1000)}${b.stderr.slice(-1500)}`);
  assert.ok(lines(b.stdout).some((l) => l.startsWith('# Spec bundle: FBS-')), 'the next actionable bundle is emitted');
  const r = await readiness(dir, []);
  assert.ok(!r.stdout.includes('Unfrozen'), `readiness no longer prints "Unfrozen"\n${r.stdout.slice(0, 600)}`);
});

test('AC-20301-3: in a scratch copy at the current head, one new requirement created through rcf define create req with no shape, story or concern entries makes define readiness --check all exit 4 naming it under the D2 and D4 checks it fails', TODO, async (t) => {
  const dir = scratchCopy(t);
  const c = await rcf(['define', 'create', 'req', '--parent', 'PRD-001', '--title', 'A fixture requirement with nothing beneath it', '--description', 'Fixture: a requirement created to show the readiness checks hold the green state.'], { cwd: dir });
  assert.equal(c.code, 0, `${c.stdout}${c.stderr}`);
  const reqId = /REQ-\d+/.exec(c.stdout)?.[0];
  assert.ok(reqId, `the create prints the new id\n${c.stdout}`);
  const r = await readiness(dir, ['--check', 'all']);
  assert.equal(r.code, 4, `${r.stdout.slice(0, 2000)}${r.stderr.slice(-800)}`);
  const doc = await readinessJson(dir);
  const failingIn = (gate) => (stageOf(doc, gate)?.checks ?? []).filter((k) => !k.ok && k.failing.some((x) => x.id === reqId)).map((k) => k.name);
  assert.ok(failingIn('define.skeleton').length > 0, `${reqId} is named under a failing D2 check`);
  assert.ok(failingIn('define.stories').length > 0, `${reqId} is named under a failing D4 check`);
  assert.ok(r.stdout.includes(reqId), `the text output names ${reqId}`);
});

// The named readiness fixture trees and the chip golden (the stage-keeper's
// ruling 8 on the Part B summary's stops): FBS-240's round DEFINE commits a
// clean tree plus one tree per D-check, D0 to D8, each built to fail that
// check, and captures each tree's Chips line from the round-base bin, from
// packages/rcf-lite, with
//   node test/_harness/goldens.js readiness-chips test/fixtures/readiness/chips.json
const READINESS_DIR = 'test/fixtures/readiness';
const CHIP_GOLDEN = 'test/fixtures/readiness/chips.json';
const READINESS_TREES = ['clean', 'd0-discovery', 'd1-brief', 'd2-skeleton', 'd3-shapes', 'd4-stories', 'd5-crosscut', 'd6-consistency', 'd7-decisions', 'd8-freeze'];
const ROUND_DEFINE_STEP = `FBS-240's round DEFINE commits the readiness fixture trees under ${READINESS_DIR}/ and captures the chip golden (node test/_harness/goldens.js readiness-chips ${CHIP_GOLDEN})`;

// The own-chain golden (the stage-keeper's ruling on part B3's open
// question 1, reading a): what AC-20301-4's own-chain half and AC-20302-3
// compare against at 639f07bb, as { "rev", "notApplicableStages",
// "liveCriteria" }, recorded by FBS-240's round DEFINE from a full clone,
// from packages/rcf-lite, with
//   node test/_harness/goldens.js own-chain test/fixtures/own-chain/at-639f07bb.json
// While it is absent the reading test fails naming that step, never skips.
const OWN_CHAIN_GOLDEN = 'test/fixtures/own-chain/at-639f07bb.json';
const OWN_CHAIN_STEP = `FBS-240's round DEFINE records the own-chain golden from a full clone (node test/_harness/goldens.js own-chain ${OWN_CHAIN_GOLDEN})`;
function ownChainGolden() {
  const file = join(pkg(), OWN_CHAIN_GOLDEN);
  assert.ok(existsSync(file), `${OWN_CHAIN_STEP}: ${OWN_CHAIN_GOLDEN} is absent`);
  const golden = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(golden.rev, MAIN_0361, `${OWN_CHAIN_GOLDEN} is the golden of 639f07bb`);
  assert.ok(Array.isArray(golden.notApplicableStages) && golden.liveCriteria && typeof golden.liveCriteria === 'object', `${OWN_CHAIN_GOLDEN} holds notApplicableStages and liveCriteria`);
  return golden;
}
const notApplicableStages = (doc) => doc.stages.filter((s) => s.state === 'notApplicable').map((s) => s.stage);

test('AC-20301-4: over the named readiness fixture trees under test/fixtures/readiness/ the bin at the current head prints the Chips line of the chip golden captured from the round-base bin, and no stage of the own chain is notApplicable at the current head that was applicable at 639f07bb as the own-chain golden records it', TODO, async () => {
  const trees = join(pkg(), READINESS_DIR);
  assert.ok(existsSync(trees), `${ROUND_DEFINE_STEP}: ${READINESS_DIR}/ is absent`);
  assert.deepEqual(readinessTrees(trees), [...READINESS_TREES].sort(), `${ROUND_DEFINE_STEP}: the named trees`);
  const golden = join(pkg(), CHIP_GOLDEN);
  assert.ok(existsSync(golden), `${ROUND_DEFINE_STEP}: ${CHIP_GOLDEN} is absent`);
  const chips = JSON.parse(readFileSync(golden, 'utf8'));
  assert.deepEqual(Object.keys(chips).sort(), [...READINESS_TREES].sort(), `${CHIP_GOLDEN} holds one Chips line per named tree`);
  for (const name of READINESS_TREES) {
    assert.equal(await readinessChips(join(trees, name)), chips[name], `${name}: the Chips line at the current head equals the chip golden`);
  }
  const wasNotApplicable = new Set(ownChainGolden().notApplicableStages);
  const now = await readinessJson(pkg());
  assert.deepEqual(notApplicableStages(now).filter((s) => !wasNotApplicable.has(s)), [], 'no stage of the own chain is notApplicable at the current head that was applicable at 639f07bb');
});

// ---------------------------------------------------------------- US-20302

const NAMED = {
  'define.skeleton': ['skeleton:reqShape', 'skeleton:tadPersistence', 'skeleton:deployAdr'],
  'define.shapes': ['shapes:tacHasInterface', 'shapes:draftSettled', 'shapes:templateMarkers'],
  'define.stories': ['stories:usFloors', 'stories:closedSets'],
  'define.crosscut': ['crosscut:securityArchitecture', 'crosscut:catalogue'],
  'define.consistency': ['consistency:contradictions', 'consistency:unsatisfiable', 'consistency:orphanInterfaces'],
};

// The check lines of one stage section in the text report, as
// "  [ok] <name> (<scope>, <persona>): <pass>/<total>".
function checkLines(stdout, gate) {
  const ls = lines(stdout);
  const at = ls.findIndex((l) => l.includes(`(${gate}):`));
  if (at === -1) return null;
  const out = [];
  for (const l of ls.slice(at + 1)) {
    const m = /^\s+\[([^\]]+)\] (\S+) \(/.exec(l);
    if (m) out.push({ mark: m[1], name: m[2] });
    else if (/^\S/.test(l)) break;
  }
  return out;
}

test('AC-20302-1: at the current head each of define readiness --check skeleton, shapes, stories, crosscut and consistency exits 0 with every one of its checks ok, the thirteen named checks included', TODO, async () => {
  for (const [gate, names] of Object.entries(NAMED)) {
    const stage = gate.slice('define.'.length);
    const r = await readiness(pkg(), ['--check', stage]);
    assert.equal(r.code, 0, `--check ${stage} exits 0\n${r.stdout.slice(0, 1500)}`);
    const checks = checkLines(r.stdout, gate);
    assert.ok(checks && checks.length > 0, `--check ${stage} reports its checks\n${r.stdout.slice(0, 1500)}`);
    assert.deepEqual(checks.filter((k) => k.mark !== 'ok').map((k) => `[${k.mark}] ${k.name}`), [], `--check ${stage}: each of its checks [ok]`);
    for (const n of names) assert.ok(checks.some((k) => k.name === n && k.mark === 'ok'), `--check ${stage} reports [ok] ${n}`);
  }
});

test('AC-20302-2: every defineD4:failure and defineD4:mustNot opt-out in rcf/manifest.json names its REQ and carries a non-empty reason, and every waived concern-ledger entry carries a non-empty reason', TODO, async () => {
  const manifest = JSON.parse(readFileSync(join(pkg(), 'rcf', 'manifest.json'), 'utf8'));
  const optOuts = (manifest.baselineAcOptOuts ?? []).filter((o) => o.baselineKey === 'defineD4:failure' || o.baselineKey === 'defineD4:mustNot');
  const bad = optOuts.filter((o) => !(o.scope === 'req' && /^REQ-\d+$/.test(o.reqId ?? '') && String(o.reason ?? '').trim()));
  assert.deepEqual(bad, [], 'each D4 opt-out names its REQ and a reason');
  const r = await rcf(['define', 'ledger', 'concerns', 'list', '--json'], { cwd: pkg() });
  assert.equal(r.code, 0, r.stderr);
  const doc = json(r.stdout);
  const entries = Array.isArray(doc) ? doc : (doc.entries ?? doc.concerns ?? []);
  const unreasoned = entries.filter((e) => e.disposition === 'waived' && !String(e.reason ?? '').trim());
  assert.deepEqual(unreasoned, [], 'every waived concern carries a reason');
});

test('AC-20302-3: no criterion live on main at 639f07bb, as the own-chain golden records it, has its description, given, when or then rewritten in place at the current head; a changed one is retired with the supersession fields and a live successor', TODO, () => {
  const then = new Map(Object.entries(ownChainGolden().liveCriteria));
  assert.ok(then.size > 0, `${OWN_CHAIN_GOLDEN} records the criteria live at 639f07bb`);
  const dir = join(pkg(), 'rcf', 'user-stories');
  const now = new Map(readdirSync(dir).flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')).acceptanceCriteria ?? []).map((a) => [a.id, a])));
  const rewritten = [];
  for (const [id, was] of then) {
    const cur = now.get(id);
    if (!cur) { rewritten.push(`${id}: gone`); continue; }
    if (cur.supersededBy) {
      if (!now.get(cur.supersededBy) || !cur.supersededOn || !cur.supersessionNote) rewritten.push(`${id}: retired without a live successor and the supersession fields`);
      continue;
    }
    for (const field of ['description', 'given', 'when', 'then']) if (JSON.stringify(cur[field]) !== JSON.stringify(was[field])) rewritten.push(`${id}.${field}`);
  }
  assert.deepEqual(rewritten, [], 'no live criterion is rewritten in place');
});

test('AC-20302-4: define readiness --check all over the own chain (about 1300 documents or more) finishes within 2 seconds on the host the suite runs on', TODO, async (t) => {
  hostFacts(t);
  const r = await readiness(pkg(), ['--check', 'all']);
  const docs = Number(/(\d+) documents/.exec(r.stdout)?.[1] ?? 0);
  assert.ok(docs >= 1300, `given: about 1300 documents or more (${docs})`);
  t.diagnostic(`readiness --check all wall ${Math.round(r.ms)} ms over ${docs} documents`);
  assert.ok(r.ms <= 2000, `within 2 seconds (${Math.round(r.ms)} ms)`);
});

// ---------------------------------------------------------------- US-20303

// The recorded profile answers: one marker of each set, read as whole
// words, and the plain words a commit body may quote them by.
const SURFACE = { viewer: /viewer|web page/i, runningApp: /runningApp|running app/i, prDiff: /prDiff|PR diff|code review diff/i };
const REGISTER = { productOwner: /productOwner|product owner/i, engineer: /engineer/i, unstated: /unstated/i };
const chosen = (text, set) => Object.keys(set).filter((m) => new RegExp(`\\b${m}\\b`).test(text));
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;

test('AC-20303-1: define readiness --level intent --check brief exits 0 with brief:profile 2/2, and the profile records one surface and one register answer naming the operator and the ruling date as their source', TODO, async () => {
  const r = await readiness(pkg(), ['--level', 'intent', '--check', 'brief']);
  assert.equal(r.code, 0, `${r.stdout.slice(0, 1500)}`);
  const check = (stageOf(await readinessJson(pkg()), 'define.brief')?.checks ?? []).find((k) => k.name === 'brief:profile');
  assert.ok(check?.ok && check.pass === 2 && check.total === 2, `brief:profile reads 2/2: ${JSON.stringify(check)}`);
  const file = join(pkg(), PROFILE);
  assert.ok(existsSync(file), `the answers are recorded in ${PROFILE}`);
  const text = readFileSync(file, 'utf8');
  assert.equal(chosen(text, SURFACE).length, 1, `one profile:surface answer is recorded: ${chosen(text, SURFACE).join(', ') || 'none'}`);
  assert.equal(chosen(text, REGISTER).length, 1, `one profile:register answer is recorded: ${chosen(text, REGISTER).join(', ') || 'none'}`);
  assert.ok(/\bthe operator\b/i.test(text) && DATE.test(text), 'the ruling source (the operator and the date of the answer) is named');
});

test('AC-20303-2: in a scratch copy at the current head with the profile answers removed, define readiness --level intent --check brief exits 4 naming profile:surface and profile:register as the product owner questions', TODO, async (t) => {
  const dir = scratchCopy(t);
  assert.ok(existsSync(join(dir, PROFILE)), `given: the copy carries ${PROFILE}`);
  writeFileSync(join(dir, PROFILE), '# Profile\n\nNo answers recorded.\n');
  const r = await readiness(dir, ['--level', 'intent', '--check', 'brief']);
  assert.equal(r.code, 4, `${r.stdout.slice(0, 1500)}`);
  const ls = lines(r.stdout);
  const at = ls.findIndex((l) => /^Product owner: /.test(l));
  assert.ok(at >= 0, `a product-owner section\n${r.stdout.slice(0, 800)}`);
  const end = ls.findIndex((l, i) => i > at && /^Engineer: /.test(l));
  const section = ls.slice(at, end === -1 ? undefined : end).join('\n');
  for (const id of ['profile:surface', 'profile:register']) assert.ok(section.includes(id), `${id} is named as a product owner question\n${section}`);
});

test('AC-20303-3: the DEFINE commit that recorded the profile answers quotes the operator answer and its date, and the recorded profile names that source', TODO, () => {
  const root = checkoutRoot();
  const rel = `packages/rcf-lite/${PROFILE}`;
  const last = gitTry(root, 'log', '-1', '--format=%H%x00%s%x00%b', '--', rel).stdout;
  assert.ok(last.trim(), `${rel} is committed`);
  const [, subject, body] = last.split('\0');
  assert.ok(subject.startsWith('DEFINE: '), `the recording commit is a DEFINE: commit: ${subject}`);
  const text = readFileSync(join(pkg(), PROFILE), 'utf8');
  const [surface] = chosen(text, SURFACE);
  const [register] = chosen(text, REGISTER);
  assert.ok(surface && register, 'the profile records both answers');
  assert.ok(/\bthe operator\b/i.test(text), 'the profile names the operator as the source');
  const date = DATE.exec(text)?.[0];
  assert.ok(date, 'the profile names the date of the answer');
  assert.ok(/\bthe operator\b/i.test(body), 'the commit names the operator');
  assert.ok(SURFACE[surface].test(body) && REGISTER[register].test(body), `the commit quotes both recorded answers (${surface}, ${register})`);
  assert.ok(body.includes(date), `the commit names the answer date ${date}`);
});
