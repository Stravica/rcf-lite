// FBS-240 (US-20301, US-20302, US-20303): readiness D1 to D6 and D8 green
// on this repository's own chain, frozen --next again, every failing check
// cleared by chain records, and the operator's two D1 profile answers.
//
// Criteria: 12 (US-20301 4, US-20302 4, US-20303 4): 11 testOnly and one
// external, AC-20303-4. Tested here: 12. AC-20301-4 compares the Chips line over the named
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
// HEAD (the stage-keeper's rule on the independent check): AC-20303-3
// reads the profile, the rcf/ trees and the ledger at HEAD and parses the
// documented answer form itself (the stage-keeper's ruling 1 on part C2's
// stop). Decision 122 is the known non-answer mention: its answer names the
// operator's answers as context, and its question asks for no key's value
// (the stage-keeper's ruling 3 before part C2).
//
// Every test is a node:test todo case ("FBS-240 round DEFINE", GR-35): it
// runs and is red until FBS-240's round DEFINE drops the marker. Each
// testOnly test reads this repository through RCF_CHECKOUT when it is set,
// else from this file's location (GR-34), and asserts at the current head ("this
// slice's reviewed head or any later head", section 8.1
// readiness-at-slice-head), so it is red today by design. A test that
// needs a scratch copy copies the package's rcf/ and test/ trees and
// package.json into a scratch git repository and runs the bin there: rcf
// define freeze and record changes run only inside that copy, never on
// the checkout. The timing test prints the host facts (GR-45). The two
// profile answers are the operator's input (GR-55), collected before
// FBS-240's round DEFINE records them: the US-20303 tests read whichever
// answers are recorded and never presume them. The external test,
// AC-20303-4, reads no file of this repository but its fixture profiles
// under test/fixtures/profile/: it drives bin/rcf.js against projects made
// by rcf init in scratch directories and reaches all five consumers (the
// D1 check, define readiness, define questions, the MCP tool over stdio and
// the viewer over loopback), stopping every server it starts. Imports:
// Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT, lines, rcf } from '../_harness/spawn.js';
import { mcpCall, viewerPage } from '../_harness/servers.js';
import { commit, gitTry, initRepo, sha, showAt } from '../_harness/git.js';
import { baseSuiteRecord, checkoutPackage, checkoutRoot, project, scratch, writeJson, writeText } from '../_harness/fixture.js';
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

// The documented answer form (the stage-keeper's ruling 1 on part C2's
// stop): under "## Surface" and under "## Register" the answer is the
// single bare line that reads only one marker word of that key. Menu
// bullets and prose never count, and a section with no bare value line,
// or with two, is unanswered. The test parses the form itself, with this
// one parser for every file the scan reaches.
const PROFILE_KEYS = {
  'profile:surface': { heading: '## Surface', plain: SURFACE },
  'profile:register': { heading: '## Register', plain: REGISTER },
};
function answerSections(text) {
  const ls = text.split(/\r?\n/);
  const out = [];
  ls.forEach((l, i) => {
    const key = Object.keys(PROFILE_KEYS).find((k) => l.trim() === PROFILE_KEYS[k].heading);
    if (!key) return;
    const bare = [];
    for (let j = i + 1; j < ls.length && !/^#{1,6}\s/.test(ls[j].trim()); j++) {
      if (Object.keys(PROFILE_KEYS[key].plain).includes(ls[j].trim())) bare.push(ls[j].trim());
    }
    out.push({ key, answer: bare.length === 1 ? bare[0] : null });
  });
  return out;
}
const stringsIn = (v, acc = []) => {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsIn(x, acc));
  return acc;
};
// Every answer in the documented form in one file: its raw text, and, for a
// JSON file, every string inside it.
function answersIn(path, text) {
  const texts = [text];
  if (path.endsWith('.json')) { try { texts.push(...stringsIn(JSON.parse(text))); } catch { /* raw text only */ } }
  return texts.flatMap((x) => answerSections(x)).filter((s) => s.answer);
}
// The source of an answer (the stage-keeper's ruling in Part C, with
// rulings 2 and 3 before part C2): a decisions-ledger entry whose question
// asks for the value of that key and whose answer opens
// "The operator, <YYYY-MM-DD>: " followed by the operator's verbatim quote
// in double quotes, with nothing after the closing quote (the stage-keeper's
// item 2 on the focused re-check, D1: the form FBS-240's notes name), the
// text inside the quotes matching the answer's marker through the plain
// words of SURFACE and REGISTER above, ignoring case. FBS-240's round DEFINE
// mints the two entries with the profile, before this marker drops.
const asksValueOf = (d, key) => String(d.question ?? '').includes(`the value of ${key}`);
const SOURCE = /^The operator, (\d{4}-\d{2}-\d{2}): "([^"]+)"$/;
const PROFILE_STEP = `FBS-240's round DEFINE records the operator's answers in ${PROFILE} and commits it`;
const SOURCE_STEP = 'FBS-240\'s round DEFINE mints the two operator source entries (node bin/rcf.js define ledger decisions add, then resolve: a question asking for the value of profile:surface or profile:register, an answer opening "The operator, 2026-10-24:" and quoting the operator in double quotes)';

test('AC-20303-3: rcf/.identity/profile.md is committed, each answer it records in the documented answer form has an operator source entry with its date in the ledger, no other file in an rcf/ tree holds an answer, and no ledger entry answers either key without the operator and a date', TODO, async (t) => {
  const root = checkoutRoot();
  const rel = `packages/rcf-lite/${PROFILE}`;
  // rcf-lite's own chain at HEAD, packages/rcf-lite/rcf/ (the stage-keeper's
  // ruling RC-5 (iii): the readiness fixture trees under test/fixtures/ are
  // synthetic data, not the operator's answers, so the scan skips them);
  // mentions of the keys in criteria, cases, TACs and Code Nodes are not
  // answers, so only the answer form is flagged.
  const tracked = gitTry(root, 'ls-tree', '-r', '--name-only', 'HEAD');
  assert.equal(tracked.code, 0, `git ls-tree HEAD in ${root}: ${tracked.stderr}`);
  const inTrees = tracked.stdout.split('\n').filter((p) => p.startsWith('packages/rcf-lite/rcf/'));
  const elsewhere = [];
  for (const [p, text] of showAt(root, 'HEAD', inTrees.filter((p) => p !== rel))) {
    for (const s of answersIn(p, text)) elsewhere.push(`${p}: ${s.key} = ${s.answer}`);
  }
  t.diagnostic(`scan: ${inTrees.length} files in rcf/ trees at HEAD; answers outside ${rel}: ${elsewhere.length}`);
  assert.deepEqual(elsewhere, [], 'no answer occurrence exists in any other file');
  const l = await rcf(['define', 'ledger', 'decisions', 'list', '--json'], { cwd: pkg() });
  assert.equal(l.code, 0, l.stderr);
  const decisions = json(l.stdout).decisions ?? [];
  const mentions = decisions.filter((d) => /profile:(surface|register)|\.identity\/profile\.md/.test(JSON.stringify(d)));
  t.diagnostic(`ledger: entries naming the profile or a profile key: ${mentions.map((d) => `${d.id} (${Object.keys(PROFILE_KEYS).filter((k) => asksValueOf(d, k)).join(', ') || 'asks for no value'})`).join('; ') || 'none'}`);
  const unsourced = decisions.filter((d) => Object.keys(PROFILE_KEYS).some((k) => asksValueOf(d, k)) && !SOURCE.test(String(d.answer ?? '')));
  assert.deepEqual(unsourced.map((d) => d.id), [], 'no ledger entry answers either key without the operator and a date');
  assert.equal(gitTry(root, 'cat-file', '-e', `HEAD:${rel}`).code, 0, `${PROFILE_STEP}: ${rel} is not committed at HEAD`);
  const answers = answerSections(readFileSync(join(pkg(), PROFILE), 'utf8')).filter((s) => s.answer);
  for (const { key, answer } of answers) {
    const sources = decisions.filter((d) => asksValueOf(d, key)).filter((d) => {
      const m = SOURCE.exec(String(d.answer ?? ''));
      return m && PROFILE_KEYS[key].plain[answer].test(m[2]);
    });
    assert.ok(sources.length > 0, `${SOURCE_STEP}: no ledger source quotes the operator for ${key} = ${answer}`);
  }
});

// AC-20303-4 (external; the stage-keeper's ruling 2 on part C2's stop and
// ruling 2 before part C3): one shared profile reader that every consumer
// resolves through, over the four fixture profiles of test/fixtures/profile/
// (how each was made: its README.md). Each fixture is written as
// rcf/.identity/profile.md of a project made by rcf init in a scratch
// directory. The oracle is the field define readiness --json reports,
// profile: { surface, register }, each value the resolved marker word or
// unanswered, which FBS-240's BUILD adds with the reader. The register
// consumers agree when each acts on the resolved register, and on
// unanswered exactly as on unstated: the persona order define readiness
// prints, the default persona of define questions --json and of the MCP
// tool rcf_define_questions, and the viewer's data-rcf-register (one page
// of rcf audit view, the server stopped). Surface is observed only through
// the JSON field and brief:profile, since no other consumer prints it.
const PROFILE_FIXTURES = join(PACKAGE_ROOT, 'test', 'fixtures', 'profile');
const RULED = {
  'i-unedited-seed.md': { surface: 'prDiff', register: 'unstated', failing: [] },
  'ii-no-bare-lines.md': { surface: 'unanswered', register: 'unanswered', failing: ['profile:register', 'profile:surface'] },
  'iii-two-bare-lines.md': { surface: 'prDiff', register: 'unanswered', failing: ['profile:register'] },
  'iv-menu-only.md': { surface: 'unanswered', register: 'unanswered', failing: ['profile:register', 'profile:surface'] },
};
const BUILD_STEP = 'FBS-240\'s BUILD delivers the shared profile reader (AC-20303-4) and every consumer resolves through it';
// What each register consumer shows for a resolved register.
const acted = (register) => (register === 'unanswered' ? 'unstated' : register);
const personaFor = (register) => (acted(register) === 'engineer' ? 'engineer' : 'productOwner');
function personaOrder(stdout) {
  const ls = lines(stdout);
  const po = ls.findIndex((l) => /^Product owner: /.test(l));
  const en = ls.findIndex((l) => /^Engineer: /.test(l));
  if (po === -1 || en === -1) return null;
  return po < en ? 'productOwner' : 'engineer';
}

test('AC-20303-4: over the four fixture profiles of test/fixtures/profile/, written into projects made by rcf init, define readiness --json reports the profile the shared reader resolves, brief:profile fails each key whose section holds no bare value line or two, and the persona order of define readiness, the default persona of define questions and of the MCP tool and the data-rcf-register of the viewer all agree with it', TODO, async (t) => {
  assert.deepEqual(readdirSync(PROFILE_FIXTURES).filter((f) => f !== 'README.md').sort(), Object.keys(RULED).sort(), 'the four fixture profiles');
  const owed = [];
  for (const [name, ruled] of Object.entries(RULED)) {
    const dir = await project(t, { name: 'profile' });
    writeText(dir, PROFILE, readFileSync(join(PROFILE_FIXTURES, name), 'utf8'));
    const doc = await readinessJson(dir);
    const oracle = doc.profile;
    if (!oracle || typeof oracle !== 'object') owed.push(`${name}: define readiness --json reports no profile field (ruled { surface: ${ruled.surface}, register: ${ruled.register} })`);
    else {
      if (oracle.surface !== ruled.surface) owed.push(`${name}: define readiness --json profile.surface ${oracle.surface}, ruled ${ruled.surface}`);
      if (oracle.register !== ruled.register) owed.push(`${name}: define readiness --json profile.register ${oracle.register}, ruled ${ruled.register}`);
    }
    const check = (stageOf(doc, 'define.brief')?.checks ?? []).find((k) => k.name === 'brief:profile');
    const failing = (check?.failing ?? []).map((x) => x.id).sort();
    if (!check) owed.push(`${name}: define readiness --json reports no brief:profile check`);
    else if (JSON.stringify(failing) !== JSON.stringify(ruled.failing)) owed.push(`${name}: brief:profile fails [${failing.join(', ')}], ruled [${ruled.failing.join(', ')}]`);
    const brief = await readiness(dir, ['--level', 'intent', '--check', 'brief']);
    const mark = lines(brief.stdout).map((l) => /^\s+\[([^\]]+)\] brief:profile \(/.exec(l)?.[1]).find(Boolean);
    if ((mark === 'ok') !== (ruled.failing.length === 0)) owed.push(`${name}: define readiness --level intent --check brief prints [${mark}] brief:profile, ruled ${ruled.failing.length ? 'failing' : '[ok]'}`);
    const order = personaOrder((await readiness(dir, [])).stdout);
    if (order !== personaFor(ruled.register)) owed.push(`${name}: define readiness prints the ${order} block first, ruled ${personaFor(ruled.register)} first (register ${ruled.register})`);
    const q = await rcf(['define', 'questions', '--json'], { cwd: dir });
    const qPersona = q.code === 0 ? json(q.stdout).persona : `exit ${q.code}`;
    if (qPersona !== personaFor(ruled.register)) owed.push(`${name}: define questions defaults to persona ${qPersona}, ruled ${personaFor(ruled.register)} (register ${ruled.register})`);
    const m = await mcpCall(dir, 'rcf_define_questions', {});
    const mPersona = m?.structuredContent?.persona;
    if (mPersona !== personaFor(ruled.register)) owed.push(`${name}: the MCP tool rcf_define_questions defaults to persona ${mPersona}, ruled ${personaFor(ruled.register)} (register ${ruled.register})`);
    const v = await viewerPage(dir, '/');
    const vRegister = /class="rcf-readiness-panel" data-rcf-register="([^"]*)"/.exec(v.html)?.[1];
    if (v.status !== 200 || vRegister !== acted(ruled.register)) owed.push(`${name}: the viewer prints data-rcf-register="${vRegister}" (status ${v.status}), ruled "${acted(ruled.register)}" (register ${ruled.register})`);
  }
  assert.deepEqual(owed, [], `${BUILD_STEP}:\n${owed.join('\n')}`);
});
