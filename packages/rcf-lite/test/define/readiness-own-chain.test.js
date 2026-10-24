// FBS-240 (US-20301, US-20302, US-20303): readiness D1 to D6 and D8 green
// on this repository's own chain, frozen --next again, every failing check
// cleared by chain records, and the operator's two D1 profile answers.
//
// Criteria: 11, all testOnly (US-20301 4, US-20302 4, US-20303 3).
// Tested here: 10. AC-20301-4 is not written: it compares chip verdicts
// "over every readiness fixture tree under packages/rcf-lite/test/", and
// no such tree exists on disk (the readiness tests build their fixtures
// in code through src/), so the set it names is undefined; returned as a
// question in this slice's DEFINE commit and left unbound.
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
// the checkout. The timing test prints the host facts (GR-45). Imports:
// Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, gitTry, initRepo, sha, showAt } from '../_harness/git.js';
import { baseSuiteRecord, checkoutPackage, checkoutRoot, scratch, writeJson } from '../_harness/fixture.js';
import { hostFacts, json } from '../_harness/capture.js';

const TODO = { todo: 'FBS-240 round DEFINE' };
const MAIN_0361 = '639f07bb99ac70bd93c298be3b15bea4eb8a38b1';
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

// ---------------------------------------------------------------- US-20302

const NAMED = {
  'define.skeleton': ['skeleton:reqShape', 'skeleton:tadPersistence', 'skeleton:deployAdr'],
  'define.shapes': ['shapes:tacHasInterface', 'shapes:draftSettled', 'shapes:templateMarkers'],
  'define.stories': ['stories:usFloors', 'stories:closedSets'],
  'define.crosscut': ['crosscut:securityArchitecture', 'crosscut:catalogue'],
  'define.consistency': ['consistency:contradictions', 'consistency:unsatisfiable', 'consistency:orphanInterfaces'],
};

test('AC-20302-1: at the current head each of define readiness --check skeleton, shapes, stories, crosscut and consistency exits 0 with every one of its checks ok, the thirteen named checks included', TODO, async () => {
  for (const stage of ['skeleton', 'shapes', 'stories', 'crosscut', 'consistency']) {
    const r = await readiness(pkg(), ['--check', stage]);
    assert.equal(r.code, 0, `--check ${stage} exits 0\n${r.stdout.slice(0, 1500)}`);
  }
  const doc = await readinessJson(pkg());
  for (const [gate, names] of Object.entries(NAMED)) {
    const checks = stageOf(doc, gate)?.checks ?? [];
    assert.deepEqual(checks.filter((k) => !k.ok).map((k) => `${k.name}: ${k.failing.slice(0, 3).map((x) => x.id).join(', ')}`), [], `${gate}: every check ok`);
    for (const n of names) assert.ok(checks.some((k) => k.name === n && k.ok), `${gate}: ${n} is reported ok`);
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

test('AC-20302-3: no criterion live on main at 639f07bb has its description, given, when or then rewritten in place at the current head; a changed one is retired with the supersession fields and a live successor', TODO, () => {
  const root = checkoutRoot();
  assert.equal(gitTry(root, 'cat-file', '-e', `${MAIN_0361}^{commit}`).code, 0, 'the 0.36.1 main commit is in the history (full-depth checkout)');
  const STORIES = 'packages/rcf-lite/rcf/user-stories';
  const paths = git(root, 'ls-tree', '--name-only', `${MAIN_0361}:${STORIES}`).split('\n').filter(Boolean).map((f) => `${STORIES}/${f}`);
  const then = new Map();
  for (const text of showAt(root, MAIN_0361, paths).values()) {
    for (const a of JSON.parse(text).acceptanceCriteria ?? []) if (!a.supersededBy) then.set(a.id, a);
  }
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

test('AC-20303-1: define readiness --level intent --check brief exits 0 with brief:profile 2/2, and the recorded answers are the operator ones (surface the running app, register product owner) with their source named', TODO, async () => {
  const r = await readiness(pkg(), ['--level', 'intent', '--check', 'brief']);
  assert.equal(r.code, 0, `${r.stdout.slice(0, 1500)}`);
  const check = (stageOf(await readinessJson(pkg()), 'define.brief')?.checks ?? []).find((k) => k.name === 'brief:profile');
  assert.ok(check?.ok && check.pass === 2 && check.total === 2, `brief:profile reads 2/2: ${JSON.stringify(check)}`);
  const file = join(pkg(), PROFILE);
  assert.ok(existsSync(file), `the answers are recorded in ${PROFILE}`);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('runningApp'), 'profile:surface is the running app (the operator answer)');
  assert.ok(text.includes('productOwner'), 'profile:register is product owner (the operator answer)');
  assert.ok(/operator/i.test(text) && text.includes('2026-10-24'), 'the ruling source (the operator, 2026-10-24) is named');
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
  assert.ok(/running app/i.test(body) && /product owner/i.test(body), 'the commit quotes the operator answers');
  assert.ok(body.includes('2026-10-24'), 'the commit names the answer date');
  const text = readFileSync(join(pkg(), PROFILE), 'utf8');
  assert.ok(/operator/i.test(text) && text.includes('2026-10-24'), 'the profile names its source');
});
