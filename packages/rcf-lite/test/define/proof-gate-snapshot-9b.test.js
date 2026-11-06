// Round G (US-19905): the gate's base, successor chains, fresh decisions
// and Finalise at the current HEAD (the stage-keeper's rulings 71 to 73,
// over the pre-freeze passes PF-1 to PF-10 and F1 to F12).
//
// The base B is the merge-base of the judged head (HEAD for the review
// verb, the reviewed head H for light Finalise) with origin/main, else
// main; both refs, when both resolve, must agree, and B is never the
// judged head. The review verb records B in review.json's base field and
// light Finalise reuses it. A retired criterion's supersededBy chain is
// followed to its live terminal, and the terminal is compared with the
// heaviest base level on the chain (one item per terminal). A decision
// counts only if it became resolved inside the range. Light Finalise also
// refuses any criterion or ledger change between H and the current HEAD
// that main did not bring. rcf/separation.json cannot class a story or
// ledger path out of criteria, and the separation audit judges a merge
// against both parents and classes a path whatever its spelling. Both
// snapshots load stories with the walker's validating loader, extend to
// rcf/test-suites/ for the touched set, and the head snapshot must equal
// the chain the walker loads.
//
// Criteria here: AC-19905-50 to AC-19905-73, each external. The fixture
// round is the round of test/define/proof-gate-snapshot.test.js (the base
// chain on main, then on branch feature a DEFINE: commit carrying the
// case's edit, a BUILD: commit with a Code Node per criterion (H), REVIEW:
// MERGE/PASS at H recording base B, TEST: PASS at H), reaching every
// earlier light Finalise check. Imports: Node builtins and test/_harness/
// only (GR-40); no git worktree (ruling 61).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { writeTap } from '../_harness/capture.js';
import { commit, git, porcelain, s7, s12, sha } from '../_harness/git.js';
import { baseSuiteRecord, bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const ROOT = 'rcf/user-stories';
const US = `${ROOT}/us-101.json`;
const US2 = `${ROOT}/us-102.json`;
const FBS = 'rcf/fbs/fbs-001.json';
const LEDGER = 'rcf/define/decisions-ledger.json';
const BOTH = ['AC-101-1', 'AC-101-2'];
const REMEDY = 're-record the Review verdict at 0.41.0 on the same head';

const LIGHTER = (base, items) => `proof lightened since ${s7(base)} without a resolved decision in ${LEDGER}: ${items}`;
const COMPARE = (base, head, reason) => `cannot compare the criteria at ${s7(base)} and ${s7(head)}: ${reason}`;

const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

const ac = (id, extra = {}) => criterion(id, `[happy] fixture criterion ${id}`, { given: 'a fixture project', when: 'the fixture runs', then: `${id} holds`, verification: 'external', ...extra });
const sym = (id) => `c${id.replace(/\D+/g, '_')}`;
const at = (dir, rel) => join(dir, rel);

function criteria(dir, rel, fn) {
  const doc = readJson(dir, rel);
  doc.acceptanceCriteria = fn(doc.acceptanceCriteria) ?? doc.acceptanceCriteria;
  writeJson(dir, rel, doc);
}
const setProof = (dir, id, proof) => criteria(dir, US, (acs) => acs.map((a) => (a.id === id ? { ...a, proof } : a)));
const retired = (id, by) => ({ supersededBy: by, supersededOn: '2026-11-06', supersessionNote: `fixture: ${id} retired` });
const retire = (dir, id, by) => criteria(dir, US, (acs) => acs.map((a) => (a.id === id ? { ...a, ...retired(id, by) } : a)));
const add = (dir, ...acs) => criteria(dir, US, (list) => [...list, ...acs]);
const touch = (dir) => editStory(dir, 'US-101', (us) => { us.acceptanceCriteria[0].description = `${us.acceptanceCriteria[0].description} Amended.`; });

async function rcfOk(dir, args) {
  const r = await rcf(args, { cwd: dir });
  assert.equal(r.code, 0, `${args.join(' ')} exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

// A decision through the ledger verbs; resolve: false leaves it open, and
// answer null resolves it with no --answer. Returns its id.
async function decide(dir, question, blocks, { answer = 'the stage-keeper ruled it', resolve = true } = {}) {
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'add', '--question', question, '--option', 'a:yes', '--option', 'b:no', '--default', 'b', '--blocks', blocks]);
  const list = JSON.parse((await rcfOk(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;
  const id = String(list.at(-1).id);
  if (resolve) await resolveDecision(dir, id, answer);
  return id;
}
const resolveDecision = (dir, id, answer = 'the stage-keeper ruled it') => rcfOk(dir, ['define', 'ledger', 'decisions', 'resolve', id, ...(answer === null ? [] : ['--answer', answer])]);
const lighten = (dir, id, from, to, opts) => decide(dir, `Lighten ${id} proof from ${from} to ${to}?`, id, opts);
const drop = (dir, id, opts) => decide(dir, `Retire ${id} with no successor?`, id, opts);

// A clean filter in the fixture's own git config: the committed blob of rel
// is the filter's output (fn applied to the parsed story), while the
// working copy, which the walker reads, stays as written.
function cleanFilter(t, dir, rel, kind, body) {
  const script = join(scratch(t, 'rcf-h-filter-'), `${kind}.cjs`);
  writeFileSync(script, `let s='';process.stdin.on('data',(d)=>{s+=d;}).on('end',()=>{const doc=JSON.parse(s);${body};process.stdout.write(JSON.stringify(doc,null,2)+'\\n');});\n`);
  git(dir, 'config', `filter.${kind}.clean`, `"${process.execPath}" "${script}"`);
  writeText(dir, `${ROOT}/.gitattributes`, `${rel.slice(ROOT.length + 1)} filter=${kind}\n`);
  touch(dir);
}

const suiteFile = (t, record) => {
  const file = join(scratch(t, 'rcf-h-suite-'), 'base-suite.json');
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
};

// The fixture round. base(ctx) edits the base chain before its commit;
// define(ctx) edits the branch before the DEFINE: commit; post(ctx) runs
// after the TEST: commit. sub puts the project in a subdirectory of the
// repository. older commits one earlier main commit (ctx.older) before the
// base chain. recorded(ctx) is the base the harness REVIEW verdict records
// (default the merge-base of main and H; undefined writes none). touched is
// the verdict's touchedAcIds (default acIds); noTest stops before TEST:.
async function round(t, { name = 'snap9b', sub = false, older = false, base, define, post, acIds = BOTH, touched, recorded, noTest = false } = {}) {
  const dir = await project(t, { name });
  const tpl = readJson(dir, US);
  const ctx = { t, dir, story: (usId, acs) => ({ ...tpl, usId, title: `story ${usId}`, acceptanceCriteria: acs }) };
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = BOTH.map((id) => ac(id)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'notStarted'; });
  writeText(sub ? dirname(dir) : dir, '.gitignore', 'node_modules/\n');
  git(sub ? dirname(dir) : dir, 'init', '-q', '-b', 'main');
  if (older) ctx.older = commit(dir, 'fixture: older main');
  if (base) await base(ctx);
  ctx.base = commit(dir, 'fixture: base chain', {}, { allowEmpty: true });
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acIds; f.executionStatus = 'inProgress'; f.summary = `${f.summary} Round opened.`; });
  if (define) await define(ctx);
  commit(dir, 'DEFINE: round');
  const files = { 'src/x.js': acIds.map((id) => `export function ${sym(id)}() { return 1; }\n`).join('') };
  acIds.forEach((acId, i) => {
    files[`rcf/code-nodes/cn-0${10 + i}.json`] = {
      cnId: `CN-0${10 + i}`, path: `src/x.js#${sym(acId)}`, title: `fixture node for ${acId}`, description: `Fixture Code Node implementing ${acId}.`,
      implementsAcIds: [acId], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
  });
  ctx.H = commit(dir, 'BUILD: code', files);
  const B = recorded ? recorded(ctx) : git(dir, 'merge-base', 'main', ctx.H);
  commit(dir, 'REVIEW: verdict', { [verdictPath(ctx.H, 'review.json')]: reviewVerdict(ctx.H, { base: B, touchedAcIds: touched ?? acIds }) });
  if (!noTest) {
    commit(dir, 'TEST: verdict', {
      [verdictPath(ctx.H, 'test.json')]: testVerdict(ctx.H),
      [verdictPath(ctx.H, 'test-strength.json')]: testStrengthReport(ctx.H, { passing: touched ?? acIds }),
    });
  }
  if (post) await post(ctx);
  return { ...ctx, acIds };
}

const MERGE = ['--code', 'MERGE', '--adequacy', 'PASS'];
const FINDINGS = ['--code', 'FINDINGS', '--adequacy', 'FINDINGS', '--finding', 'spec:-:a fixture finding'];
const review = (rnd, codes) => rcf(['build', 'verdict', 'review', '--fbs', 'FBS-001', '--acs', rnd.acIds.join(','), ...codes], { cwd: rnd.dir });
const finalise = (rnd, extra = []) => rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7', ...extra], { cwd: rnd.dir });

// The review verb refuses MERGE/PASS with rest(HEAD) after its prefix,
// exit 4, writing nothing, and still records FINDINGS (ruling 51).
async function reviewRefused(rnd, rest) {
  const { dir } = rnd;
  const head = sha(dir);
  const rel = verdictPath(head, 'review.json');
  const st = porcelain(dir);
  const fbs = readText(dir, FBS);
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 4, `build verdict review MERGE/PASS exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  errHas(r, `verdict refused: ${rest(head)}`);
  assert.equal(existsSync(at(dir, rel)), false, `no ${rel} is written`);
  assert.equal(readText(dir, FBS), fbs, 'rcf/fbs/fbs-001.json is byte-identical after the review refusal');
  assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged after the review refusal');
  const f = await review(rnd, FINDINGS);
  assert.equal(f.code, 0, `build verdict review FINDINGS/FINDINGS exits 0\nstdout:\n${f.stdout}\nstderr:\n${f.stderr}`);
  assert.ok(existsSync(at(dir, rel)), `FINDINGS writes ${rel}`);
  rmSync(at(dir, rel));
  if (!existsSync(at(dir, 'rcf/verdicts', s12(head)))) return;
  rmSync(at(dir, 'rcf/verdicts', s12(head)), { recursive: true });
}

// Light Finalise refuses with the one stderr line, exit 4, writing nothing.
async function finaliseRefused(rnd, line, extra = []) {
  const { dir } = rnd;
  const st = porcelain(dir);
  const fbs = readText(dir, FBS);
  const n = await finalise(rnd, extra);
  assert.equal(n.code, 4, `build finalise exits 4\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
  errHas(n, line);
  assert.equal(readText(dir, FBS), fbs, 'rcf/fbs/fbs-001.json is byte-identical');
  assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged after the Finalise refusal');
}

// Both verbs refuse: rest(head) after the prefix, head the judged head
// (HEAD for the review verb, H for light Finalise).
async function refusedBoth(rnd, rest) {
  await reviewRefused(rnd, rest);
  await finaliseRefused(rnd, `finalise refused: ${rest(rnd.H)}`);
}

// Both verbs pass: review writes MERGE/PASS for HEAD recording base, and
// light Finalise writes complete.
async function passedBoth(rnd, { extra = [] } = {}) {
  const { dir } = rnd;
  const head = sha(dir);
  const rel = verdictPath(head, 'review.json');
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 0, `build verdict review MERGE/PASS exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(existsSync(at(dir, rel)), `${rel} is written`);
  rmSync(at(dir, 'rcf/verdicts', s12(head)), { recursive: true });
  const n = await finalise(rnd, extra);
  assert.equal(n.code, 0, `build finalise exits 0\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
  assert.equal(readJson(dir, FBS).executionStatus, 'complete', 'complete is written');
}

// Finalise alone passes.
async function finalisePassed(rnd, extra = []) {
  const n = await finalise(rnd, extra);
  assert.equal(n.code, 0, `build finalise exits 0\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
  assert.equal(readJson(rnd.dir, FBS).executionStatus, 'complete', 'complete is written');
}

const lightened = (rnd, items) => () => LIGHTER(rnd.base, items);
const cannot = (rnd, reason) => (head) => COMPARE(rnd.base, head, reason(head));

// Main moves on after the fork and FINALISE: merge main brings it in;
// mainEdit(dir) edits main before its commit. Returns the merge head M.
async function mergeMain(dir, mainEdit) {
  git(dir, 'switch', '-q', 'main');
  writeText(dir, 'notes.txt', 'main moved\n');
  if (mainEdit) await mainEdit(dir);
  commit(dir, 'chore: main moves on');
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'main');
  return sha(dir);
}
const mainStory = (dir) => {
  const us = readJson(dir, US);
  writeJson(dir, US2, { ...us, usId: 'US-102', title: 'story US-102 from main', acceptanceCriteria: [ac('AC-102-1')] });
};

// ------------------------------------------------------------ the base

test('AC-19905-50: with origin/main at an older main commit, before AC-101-3 was added, and main at the fork, so their merge-bases with the judged head differ, while the branch sets AC-101-3 external, rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one line naming both merge-bases, writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, {
    name: 'b9-agree', older: true, acIds: [...BOTH, 'AC-101-3'],
    base: ({ dir }) => { add(dir, ac('AC-101-3')); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
    define: ({ dir }) => setProof(dir, 'AC-101-3', 'external'),
    post: ({ dir, older }) => git(dir, 'update-ref', 'refs/remotes/origin/main', older),
  });
  await refusedBoth(rnd, (head) => `origin/main and main give different merge-bases with ${s7(head)}: ${s7(rnd.older)} (origin/main) and ${s7(rnd.base)} (main)`);
});

test('AC-19905-51: with main moved to HEAD of the round and no origin/main, so the base is the judged head, rcf build verdict review MERGE/PASS exits 4 with "verdict refused: the base <B7> equals the judged head <J7>", and light Finalise over a verdict recording base H exits 4 with the same line for H, writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, {
    name: 'b9-same',
    define: ({ dir }) => setProof(dir, 'AC-101-1', 'external'),
    recorded: ({ H }) => H,
    post: ({ dir }) => git(dir, 'branch', '-f', 'main', 'HEAD'),
  });
  await refusedBoth(rnd, (head) => `the base ${s7(head)} equals the judged head ${s7(head)}`);
});

test('AC-19905-52: rcf build verdict review MERGE/PASS writes review.json with base, the 40-hex merge-base of HEAD with main, placed after head', async (t) => {
  const rnd = await round(t, { name: 'b9-records' });
  const head = sha(rnd.dir);
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 0, `build verdict review MERGE/PASS exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const v = readJson(rnd.dir, verdictPath(head, 'review.json'));
  assert.equal(v.base, rnd.base, `review.json records base ${rnd.base}\n${JSON.stringify(v, null, 2)}`);
  assert.match(String(v.base), /^[0-9a-f]{40}$/, 'base is 40 lower-case hex');
  const keys = Object.keys(v);
  assert.equal(keys[keys.indexOf('head') + 1], 'base', `base follows head: ${keys.join(', ')}`);
});

test('AC-19905-53 (a): light Finalise over a MERGE/PASS review verdict that records no base exits 4 naming the verdict path and the remedy, writing nothing', async (t) => {
  const rnd = await round(t, { name: 'b9-nobase', recorded: () => undefined });
  await finaliseRefused(rnd, `finalise refused: the review verdict ${verdictPath(rnd.H, 'review.json')} records no base; ${REMEDY}`);
});

test('AC-19905-53 (b): light Finalise over a MERGE/PASS review verdict whose base is not 40 lower-case hex exits 4 naming the verdict path and the remedy, writing nothing', async (t) => {
  for (const [label, bad] of [['short', (ctx) => ctx.base.slice(0, 12)], ['upper', (ctx) => ctx.base.toUpperCase()], ['ref', () => 'main']]) {
    const rnd = await round(t, { name: `b9-badbase-${label}`, recorded: bad });
    await finaliseRefused(rnd, `finalise refused: the review verdict ${verdictPath(rnd.H, 'review.json')} records a malformed base; ${REMEDY}`);
  }
});

test('AC-19905-53 (c): light Finalise over a MERGE/PASS review verdict whose base is a commit other than the merge-base of H exits 4 naming the verdict path, both bases and the remedy, writing nothing', async (t) => {
  const rnd = await round(t, { name: 'b9-otherbase', older: true, recorded: ({ older }) => older });
  await finaliseRefused(rnd, `finalise refused: the review verdict ${verdictPath(rnd.H, 'review.json')} records base ${s7(rnd.older)}, not the merge-base ${s7(rnd.base)} of ${s7(rnd.H)}; ${REMEDY}`);
});

// ------------------------------------------------------ successor chains

// AC-101-2 (full at the base) retired to AC-101-3, created and retired in
// the same commit to AC-101-4 at external.
const twoHop = (decision) => ({
  acIds: [...BOTH, 'AC-101-3', 'AC-101-4'],
  define: async ({ dir }) => {
    retire(dir, 'AC-101-2', 'AC-101-3');
    add(dir, ac('AC-101-3', retired('AC-101-3', 'AC-101-4')), ac('AC-101-4', { proof: 'external' }));
    if (decision) await lighten(dir, 'AC-101-4', 'full', 'external');
  },
});
// AC-101-2 retired to AC-101-3, created and retired to AC-101-9 (no such id).
const danglingHop = (decision) => ({
  acIds: [...BOTH, 'AC-101-3'],
  define: async ({ dir }) => {
    retire(dir, 'AC-101-2', 'AC-101-3');
    add(dir, ac('AC-101-3', retired('AC-101-3', 'AC-101-9')));
    if (decision) await drop(dir, 'AC-101-2');
  },
});

test('AC-19905-54: a supersededBy chain followed past a criterion created and retired in the same range, AC-101-2 to AC-101-3 to AC-101-4 at external, makes both verbs exit 4 with the lightening line naming the terminal AC-101-4 from full; a chain whose second link names no criterion at head names AC-101-2 retired with no successor; writing nothing, FINDINGS still recorded', async (t) => {
  const a = await round(t, { name: 'b9-twohop', ...twoHop(false) });
  await refusedBoth(a, lightened(a, 'AC-101-4 from full to external'));
  const b = await round(t, { name: 'b9-dangle', ...danglingHop(false) });
  await refusedBoth(b, lightened(b, 'AC-101-2 retired with no successor'));
});

test('AC-19905-55: a supersededBy chain that loops, AC-101-2 to itself or AC-101-2 to AC-101-3 (created in the range) and back, makes both verbs exit 4 with the cannot-compare line "the supersededBy chain from AC-101-2 loops at <head7>", writing nothing; FINDINGS is still recorded', async (t) => {
  const self = await round(t, { name: 'b9-self', define: ({ dir }) => retire(dir, 'AC-101-2', 'AC-101-2') });
  await refusedBoth(self, cannot(self, (head) => `the supersededBy chain from AC-101-2 loops at ${s7(head)}`));
  const loop = await round(t, {
    name: 'b9-loop', acIds: [...BOTH, 'AC-101-3'],
    define: ({ dir }) => { retire(dir, 'AC-101-2', 'AC-101-3'); add(dir, ac('AC-101-3', retired('AC-101-3', 'AC-101-2'))); },
  });
  await refusedBoth(loop, cannot(loop, (head) => `the supersededBy chain from AC-101-2 loops at ${s7(head)}`));
});

// AC-101-2 at full and AC-101-3 at journey on main; the branch retires
// AC-101-2 to the existing AC-101-3, keeping it at journey.
const existing = (decision) => ({
  acIds: [...BOTH, 'AC-101-3'],
  base: ({ dir }) => { add(dir, ac('AC-101-3', { proof: 'journey' })); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
  define: async ({ dir }) => { retire(dir, 'AC-101-2', 'AC-101-3'); if (decision) await lighten(dir, 'AC-101-3', 'full', 'journey'); },
});
// AC-101-2 at full and AC-101-3 at journey on main, both retired at head
// to a new AC-101-4 at external; decided is the from-level of a decision.
const converge = (decided) => ({
  acIds: [...BOTH, 'AC-101-3', 'AC-101-4'],
  base: ({ dir }) => { add(dir, ac('AC-101-3', { proof: 'journey' })); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
  define: async ({ dir }) => {
    retire(dir, 'AC-101-2', 'AC-101-4');
    retire(dir, 'AC-101-3', 'AC-101-4');
    add(dir, ac('AC-101-4', { proof: 'external' }));
    if (decided) await lighten(dir, 'AC-101-4', decided, 'external');
  },
});

test('AC-19905-56: a successor that existed at the base is compared with the heaviest of its own base level and that of every predecessor, one item per successor: AC-101-3 (journey at the base) succeeding AC-101-2 (full) names AC-101-3 from full to journey; AC-101-3 (full at the base) lightened to external while succeeding AC-101-2 (external) names AC-101-3 from full to external once; AC-101-2 (full) and AC-101-3 (journey) converging on AC-101-4 at external name AC-101-4 from full to external, with or without a decision from journey; writing nothing, FINDINGS still recorded', async (t) => {
  const a = await round(t, { name: 'b9-exist', ...existing(false) });
  await refusedBoth(a, lightened(a, 'AC-101-3 from full to journey'));
  const b = await round(t, {
    name: 'b9-exist-own', acIds: [...BOTH, 'AC-101-3'],
    base: ({ dir }) => { setProof(dir, 'AC-101-2', 'external'); add(dir, ac('AC-101-3')); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
    define: ({ dir }) => { retire(dir, 'AC-101-2', 'AC-101-3'); setProof(dir, 'AC-101-3', 'external'); },
  });
  await refusedBoth(b, lightened(b, 'AC-101-3 from full to external'));
  for (const decided of [null, 'journey']) {
    const c = await round(t, { name: `b9-converge-${decided ?? 'none'}`, ...converge(decided) });
    await refusedBoth(c, lightened(c, 'AC-101-4 from full to external'));
  }
});

test('AC-19905-57: a criterion retired at the base and live again at head is compared as live: AC-101-2 (full, retired at the base to AC-101-3) restored at external names AC-101-2 from full to external at both verbs, and restored at its base level passes both', async (t) => {
  const restored = (proof) => ({
    acIds: [...BOTH, 'AC-101-3'],
    base: ({ dir }) => { retire(dir, 'AC-101-2', 'AC-101-3'); add(dir, ac('AC-101-3')); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
    define: ({ dir }) => criteria(dir, US, (acs) => acs.map((a) => {
      if (a.id !== 'AC-101-2') return a;
      const { supersededBy, supersededOn, supersessionNote, ...live } = a;
      return proof ? { ...live, proof } : live;
    })),
  });
  const a = await round(t, { name: 'b9-relive', ...restored('external') });
  await refusedBoth(a, lightened(a, 'AC-101-2 from full to external'));
  await passedBoth(await round(t, { name: 'b9-relive-ok', ...restored(null) }));
});

// ------------------------------------------------------ fresh decisions

test('AC-19905-58: a decision already resolved in the ledger at the base authorises nothing: "Lighten AC-101-1 proof from full to external?" resolved at the base with AC-101-1 lightened at head, and "Retire AC-101-2 with no successor?" resolved at the base with AC-101-2 retired to no criterion at head, make both verbs exit 4 with the lightening line, writing nothing; FINDINGS is still recorded', async (t) => {
  const a = await round(t, {
    name: 'b9-stale-lighten',
    base: async ({ dir }) => { await lighten(dir, 'AC-101-1', 'full', 'external'); },
    define: ({ dir }) => setProof(dir, 'AC-101-1', 'external'),
  });
  await refusedBoth(a, lightened(a, 'AC-101-1 from full to external'));
  const b = await round(t, {
    name: 'b9-stale-retire',
    base: async ({ dir }) => { await drop(dir, 'AC-101-2'); },
    define: ({ dir }) => retire(dir, 'AC-101-2', 'AC-101-9'),
  });
  await refusedBoth(b, lightened(b, 'AC-101-2 retired with no successor'));
});

test('AC-19905-59: with each matching decision added and resolved with a non-empty answer inside the range (or open at the base and resolved inside it), the two-hop chain, the dangling chain, the existing successor, the convergence and the lightening of AC-19905-58 pass: rcf build verdict review MERGE/PASS exits 0 writing review.json and light Finalise exits 0 writing complete', async (t) => {
  await passedBoth(await round(t, { name: 'b9-ok-twohop', ...twoHop(true) }));
  await passedBoth(await round(t, { name: 'b9-ok-dangle', ...danglingHop(true) }));
  await passedBoth(await round(t, { name: 'b9-ok-exist', ...existing(true) }));
  await passedBoth(await round(t, { name: 'b9-ok-converge', ...converge('full') }));
  const ctx = {};
  await passedBoth(await round(t, {
    name: 'b9-ok-opened',
    base: async ({ dir }) => { ctx.id = await lighten(dir, 'AC-101-1', 'full', 'external', { resolve: false }); },
    define: async ({ dir }) => { setProof(dir, 'AC-101-1', 'external'); await resolveDecision(dir, ctx.id); },
  }));
});

// ------------------------------------------- Finalise at the current HEAD

test('AC-19905-60: a change after the reviewed head H that main did not bring refuses light Finalise with "finalise refused: the criteria changed after the reviewed head <H7>: <items>; reopen Review": a FINALISE: commit setting AC-101-1 external, a FINALISE: commit adding a resolved decision to rcf/define/decisions-ledger.json, and a FINALISE: merge main whose merge commit itself sets AC-101-1 external, writing nothing', async (t) => {
  const reopen = (rnd, items) => `finalise refused: the criteria changed after the reviewed head ${s7(rnd.H)}: ${items}; reopen Review`;
  const a = await round(t, { name: 'b9-after-proof', post: ({ dir }) => { setProof(dir, 'AC-101-1', 'external'); commit(dir, 'FINALISE: proof'); } });
  await finaliseRefused(a, reopen(a, 'AC-101-1'));
  const b = await round(t, { name: 'b9-after-ledger', post: async ({ dir }) => { await lighten(dir, 'AC-101-2', 'full', 'external'); commit(dir, 'FINALISE: ledger'); } });
  await finaliseRefused(b, reopen(b, LEDGER));
  const c = await round(t, {
    name: 'b9-after-merge',
    post: (ctx) => {
      const { dir } = ctx;
      git(dir, 'switch', '-q', 'main');
      commit(dir, 'chore: main moves on', { 'notes.txt': 'main moved\n' });
      git(dir, 'switch', '-q', 'feature');
      git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'main');
      setProof(dir, 'AC-101-1', 'external');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'FINALISE: merge main');
      ctx.M = sha(dir);
    },
  });
  await finaliseRefused(c, reopen(c, 'AC-101-1'), ['--merge-suite', suiteFile(t, baseSuiteRecord(c.M))]);
});

test('AC-19905-61: with REVIEW MERGE/PASS at H and a FINALISE: commit after it changing AC-101-1 to external or adding a decision to rcf/define/decisions-ledger.json, rcf build verdict test --result PASS exits 4 with "verdict refused: HEAD differs from the reviewed head <H7> outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes" and writes no test.json (the refusal of today, pinned)', async (t) => {
  const posts = [
    ['proof', ({ dir }) => { setProof(dir, 'AC-101-1', 'external'); commit(dir, 'FINALISE: proof'); }],
    ['ledger', async ({ dir }) => { await lighten(dir, 'AC-101-2', 'full', 'external'); commit(dir, 'FINALISE: ledger'); }],
  ];
  for (const [label, post] of posts) {
    const rnd = await round(t, { name: `b9-test-${label}`, noTest: true, post });
    const tap = writeTap(join(scratch(t, 'rcf-h-tap-'), 'run.tap'), [{ name: 'fixture behaviour holds' }]);
    const st = porcelain(rnd.dir);
    const r = await rcf(['build', 'verdict', 'test', '--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap, '--runtime', 'fixture app on localhost'], { cwd: rnd.dir });
    assert.equal(r.code, 4, `${label}: build verdict test PASS exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    errHas(r, `verdict refused: HEAD differs from the reviewed head ${s7(rnd.H)} outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes`);
    assert.equal(existsSync(at(rnd.dir, verdictPath(rnd.H, 'test.json'))), false, `${label}: no test.json is written`);
    assert.equal(porcelain(rnd.dir), st, `${label}: git status --porcelain is unchanged`);
  }
});

test('AC-19905-62: a change main brought in after the fork passes light Finalise: FINALISE: merge main bringing a story US-102 added on main and a decision added to the ledger on main, with --merge-suite naming a green record at the merge head, exits 0 and writes complete', async (t) => {
  const rnd = await round(t, { name: 'b9-main-brings' });
  const M = await mergeMain(rnd.dir, async (dir) => { mainStory(dir); await lighten(dir, 'AC-102-1', 'full', 'external'); });
  await finalisePassed(rnd, ['--merge-suite', suiteFile(t, baseSuiteRecord(M))]);
});

// ------------------------------------------------ separation and classes

test('AC-19905-63: rcf/separation.json classing a story path as chainStatus or the ledger as lockfile makes rcf define validate exit 3 naming rcf/separation.json, the class and the path, and rcf build verdict review MERGE/PASS and light Finalise exit 4 with "<prefix> rcf/separation.json classes <path> as <class>; a story or ledger path is always criteria", writing nothing; FINDINGS is still recorded', async (t) => {
  const cases = [
    ['chainStatus', 'rcf/user-stories/**', US, ({ dir }) => touch(dir)],
    ['lockfile', LEDGER, LEDGER, async ({ dir }) => { await lighten(dir, 'AC-101-2', 'full', 'journey'); }],
  ];
  for (const [cls, glob, path, edit] of cases) {
    const rnd = await round(t, {
      name: `b9-class-${cls}`,
      define: async (ctx) => { writeJson(ctx.dir, 'rcf/separation.json', { classes: { [cls]: [glob] }, generators: [] }); await edit(ctx); },
    });
    const v = await rcf(['define', 'validate'], { cwd: rnd.dir });
    assert.equal(v.code, 3, `${cls}: define validate exits 3\nstdout:\n${v.stdout}\nstderr:\n${v.stderr}`);
    for (const word of ['rcf/separation.json', cls, path]) assert.ok(`${v.stdout}${v.stderr}`.includes(word), `${cls}: define validate names ${word}\n${v.stdout}${v.stderr}`);
    await refusedBoth(rnd, () => `rcf/separation.json classes ${path} as ${cls}; a story or ledger path is always criteria`);
  }
});

test('AC-19905-64: a FINALISE: merge whose second parent is a commit off the branch, not on main, changing rcf/user-stories/us-101.json makes rcf audit separation exit 4 naming the merge as touching that path (class criteria, owned by DEFINE), and light Finalise exit 4 with that separation item, writing nothing', async (t) => {
  const rnd = await round(t, {
    name: 'b9-sidemerge',
    post: (ctx) => {
      const { dir } = ctx;
      git(dir, 'switch', '-q', '-c', 'side');
      touch(dir);
      commit(dir, 'DEFINE: side note');
      git(dir, 'switch', '-q', 'feature');
      git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'side');
      ctx.M = sha(dir);
    },
  });
  const item = `${s7(rnd.M)} FINALISE: touches ${US} (class criteria, owned by DEFINE)`;
  const s = await rcf(['audit', 'separation', '--base', rnd.base], { cwd: rnd.dir });
  assert.equal(s.code, 4, `audit separation exits 4\nstdout:\n${s.stdout}\nstderr:\n${s.stderr}`);
  assert.ok(s.stdout.includes(item), `audit separation names "${item}"\n${s.stdout}${s.stderr}`);
  await finaliseRefused(rnd, `finalise refused: separation FAIL: ${item}`, ['--merge-suite', suiteFile(t, baseSuiteRecord(rnd.M))]);
});

// ------------------------------------------------- the snapshot's loads

test('AC-19905-65: a criterion retired at the base (AC-101-2, to AC-101-3) and deleted at head makes both verbs exit 4 with the cannot-compare line "AC-101-2 is absent at <head7>", writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, {
    name: 'b9-retired-deleted', acIds: ['AC-101-1', 'AC-101-3'],
    base: ({ dir }) => { retire(dir, 'AC-101-2', 'AC-101-3'); add(dir, ac('AC-101-3')); editFbs(dir, 'FBS-001', (f) => { f.acIds = [...BOTH, 'AC-101-3']; }); },
    define: ({ dir }) => criteria(dir, US, (acs) => acs.filter((a) => a.id !== 'AC-101-2')),
  });
  await refusedBoth(rnd, cannot(rnd, (head) => `AC-101-2 is absent at ${s7(head)}`));
});

test('AC-19905-66: a story that parses but fails schema validation, rcf/user-stories/us-102.json at the base (removed at head) or the committed head blob of us-101.json (its working copy valid), makes both verbs exit 4 with the cannot-compare line "<path> fails schema validation at <rev7>", writing nothing; FINDINGS is still recorded', async (t) => {
  const a = await round(t, {
    name: 'b9-invalid-base',
    base: ({ dir, story }) => writeJson(dir, US2, story('US-102', [ac('AC-102-1', { verification: 'sometimes' })])),
    define: ({ dir }) => rmSync(at(dir, US2)),
  });
  await refusedBoth(a, cannot(a, () => `${US2} fails schema validation at ${s7(a.base)}`));
  const b = await round(t, { name: 'b9-invalid-head', define: ({ t: tt, dir }) => cleanFilter(tt, dir, US, 'invalid', "doc.acceptanceCriteria[0].verification='sometimes'") });
  await refusedBoth(b, cannot(b, (head) => `${US} fails schema validation at ${s7(head)}`));
});

test('AC-19905-67: a proof value outside full, journey and external, on AC-101-2 at the base or in the committed head blob of us-101.json, is a cannot-compare fault "<path> fails schema validation at <rev7>" at both verbs, never skipped, writing nothing; FINDINGS is still recorded', async (t) => {
  const a = await round(t, {
    name: 'b9-proof-base',
    base: ({ dir }) => setProof(dir, 'AC-101-2', 'partial'),
    define: ({ dir }) => criteria(dir, US, (acs) => acs.map(({ proof, ...rest }) => rest)),
  });
  await refusedBoth(a, cannot(a, () => `${US} fails schema validation at ${s7(a.base)}`));
  const b = await round(t, { name: 'b9-proof-head', define: ({ t: tt, dir }) => cleanFilter(tt, dir, US, 'partial', "doc.acceptanceCriteria[0].proof='partial'") });
  await refusedBoth(b, cannot(b, (head) => `${US} fails schema validation at ${s7(head)}`));
});

test('AC-19905-68: the separation audit classes a story or chain path whatever its spelling: a DEFINE: commit adding rcf/user-stories/us-101-"q.json, rcf/user-stories/us-ü.json and rcf/test-suites/ts-"q.json passes, a BUILD: commit touching rcf/user-stories/us-101-"q.json fails naming it (class criteria, owned by DEFINE), and light Finalise passes the decided C-quoted rename of AC-19905-49', async (t) => {
  const dir = join(scratch(t, 'rcf-h-spell-'), 'repo');
  git(dirname(dir), 'init', '-q', '-b', 'main', 'repo');
  const base = commit(dir, 'base', { 'README.md': '# fixture\n' });
  git(dir, 'switch', '-q', '-c', 'feature');
  commit(dir, 'DEFINE: criteria', { [`${ROOT}/us-101-"q.json`]: '{"n":1}\n', [`${ROOT}/us-ü.json`]: '{"n":2}\n', 'rcf/test-suites/ts-"q.json': '{"n":3}\n' });
  const ok = await rcf(['audit', 'separation', '--base', base], { cwd: dir });
  assert.equal(ok.code, 0, `the DEFINE: commit passes\nstdout:\n${ok.stdout}\nstderr:\n${ok.stderr}`);
  const bad = commit(dir, 'BUILD: code', { 'src/x.js': 'export const x = 1;\n', [`${ROOT}/us-101-"q.json`]: '{"n":4}\n' });
  const r = await rcf(['audit', 'separation', '--base', base], { cwd: dir });
  assert.equal(r.code, 4, `the BUILD: commit fails\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const item = `${s7(bad)} BUILD: touches ${ROOT}/us-101-"q.json (class criteria, owned by DEFINE)`;
  assert.ok(r.stdout.includes(item), `stdout names "${item}"\n${r.stdout}${r.stderr}`);

  const QUOTED = `${ROOT}/us-101-"q.json`;
  const rnd = await round(t, {
    name: 'b9-quoted-ok',
    base: ({ dir: d }) => renameSync(at(d, US), at(d, QUOTED)),
    define: async ({ dir: d }) => { renameSync(at(d, QUOTED), at(d, US)); setProof(d, 'AC-101-1', 'external'); await lighten(d, 'AC-101-1', 'full', 'external'); },
  });
  await finalisePassed(rnd);
});

test('AC-19905-69: the touched set comes from the test-suite snapshots: with the review verdict touching AC-101-1 only and a base test suite at rcf/test-suites/ts-"q.json (a spelling Git C-quotes) binding AC-101-2, deleted at head, light Finalise exits 4 with "finalise refused: touched criteria omit AC-101-2 changed since <base7>", writing nothing', async (t) => {
  const QTS = 'rcf/test-suites/ts-"q.json';
  const rnd = await round(t, {
    name: 'b9-ts-quoted', touched: ['AC-101-1'],
    base: ({ dir }) => {
      bindTests(dir, [{ acId: 'AC-101-2', pointer: 'test/rcf/b.test.js::second behaviour holds' }], { tsId: 'TS-002' });
      renameSync(at(dir, 'rcf/test-suites/ts-002.json'), at(dir, QTS));
    },
    define: ({ dir }) => rmSync(at(dir, QTS)),
  });
  await finaliseRefused(rnd, `finalise refused: touched criteria omit AC-101-2 changed since ${s7(rnd.base)}`);
});

test('AC-19905-70: a head snapshot whose levels or ids differ from the chain the walker loads at HEAD (a clean filter commits AC-101-1 with no proof while its working copy says external, or commits an extra AC-101-9) makes both verbs exit 4 with the cannot-compare line "the chain loaded at HEAD differs from <HEAD7> for <ids>", writing nothing; FINDINGS is still recorded', async (t) => {
  const cases = [
    ['level', 'AC-101-1', ({ t: tt, dir }) => { setProof(dir, 'AC-101-1', 'external'); cleanFilter(tt, dir, US, 'level', 'delete doc.acceptanceCriteria[0].proof'); }],
    ['id', 'AC-101-9', ({ t: tt, dir }) => cleanFilter(tt, dir, US, 'extra', "doc.acceptanceCriteria.push({...doc.acceptanceCriteria[0], id: 'AC-101-9'})")],
  ];
  for (const [label, ids, define] of cases) {
    const rnd = await round(t, { name: `b9-walker-${label}`, define });
    const HEAD = sha(rnd.dir);
    await refusedBoth(rnd, cannot(rnd, () => `the chain loaded at HEAD differs from ${s7(HEAD)} for ${ids}`));
  }
});

// -------------------------------------------- a project in a subdirectory

test('AC-19905-71: with the project in a subdirectory of the repository (as packages/rcf-lite is), a base criterion deleted at head makes both verbs exit 4 with the cannot-compare line "AC-101-2 is absent at <head7>", writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, { name: 'b9-sub-absent', sub: true, acIds: ['AC-101-1'], define: ({ dir }) => criteria(dir, US, (acs) => acs.filter((a) => a.id !== 'AC-101-2')) });
  await refusedBoth(rnd, cannot(rnd, (head) => `AC-101-2 is absent at ${s7(head)}`));
});

test('AC-19905-72: with the project in a subdirectory of the repository, a lightening of AC-101-1 with its decision resolved inside the range lets rcf build verdict review MERGE/PASS exit 0 writing review.json with base the merge-base of HEAD with main, and light Finalise exit 0 writing complete', async (t) => {
  const rnd = await round(t, { name: 'b9-sub-ok', sub: true, define: async ({ dir }) => { setProof(dir, 'AC-101-1', 'external'); await lighten(dir, 'AC-101-1', 'full', 'external'); } });
  const head = sha(rnd.dir);
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 0, `build verdict review MERGE/PASS exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(readJson(rnd.dir, verdictPath(head, 'review.json')).base, rnd.base, 'review.json records the base');
  rmSync(at(rnd.dir, 'rcf/verdicts', s12(head)), { recursive: true });
  await finalisePassed(rnd);
});

// ------------------------------------------------------- the fault order

test('AC-19905-73: with AC-101-2 and AC-101-3 deleted and AC-101-1 and AC-101-4 lightened without a decision, both verbs exit 4 with exactly two lines, the cannot-compare line listing every absent id then the lightening line listing the rest in id order; with also an unparseable base us-102.json, the snapshot fault is the one line', async (t) => {
  const four = ['AC-101-1', 'AC-101-2', 'AC-101-3', 'AC-101-4'];
  const faults = (broken) => ({
    acIds: ['AC-101-1', 'AC-101-4'],
    base: ({ dir }) => {
      add(dir, ac('AC-101-3'), ac('AC-101-4'));
      editFbs(dir, 'FBS-001', (f) => { f.acIds = four; });
      if (broken) writeText(dir, US2, '{ not json\n');
    },
    define: ({ dir }) => {
      criteria(dir, US, (acs) => acs.filter((a) => a.id !== 'AC-101-2' && a.id !== 'AC-101-3'));
      setProof(dir, 'AC-101-1', 'journey');
      setProof(dir, 'AC-101-4', 'external');
      if (broken) rmSync(at(dir, US2));
    },
  });
  const verbs = (rnd) => [['verdict refused:', () => review(rnd, MERGE), sha(rnd.dir)], ['finalise refused:', () => finalise(rnd), rnd.H]];
  const a = await round(t, { name: 'b9-order', ...faults(false) });
  const kept = (rnd) => ({ st: porcelain(rnd.dir), fbs: readText(rnd.dir, FBS), rel: verdictPath(sha(rnd.dir), 'review.json') });
  const unchanged = (rnd, k, prefix) => {
    assert.equal(existsSync(at(rnd.dir, k.rel)), false, `${prefix} no ${k.rel} is written`);
    assert.equal(readText(rnd.dir, FBS), k.fbs, `${prefix} rcf/fbs/fbs-001.json is byte-identical`);
    assert.equal(porcelain(rnd.dir), k.st, `${prefix} git status --porcelain is unchanged`);
  };
  const ka = kept(a);
  for (const [prefix, run, head] of verbs(a)) {
    const r = await run();
    assert.equal(r.code, 4, `${prefix} exit 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.deepEqual(lines(r.stderr).filter((l) => l.startsWith(prefix)), [
      `${prefix} ${COMPARE(a.base, head, `AC-101-2 is absent at ${s7(head)}, AC-101-3 is absent at ${s7(head)}`)}`,
      `${prefix} ${LIGHTER(a.base, 'AC-101-1 from full to journey, AC-101-4 from full to external')}`,
    ], `${prefix} the two lines in order\n${r.stderr}`);
    unchanged(a, ka, prefix);
  }
  const b = await round(t, { name: 'b9-order-snap', ...faults(true) });
  const kb = kept(b);
  for (const [prefix, run, head] of verbs(b)) {
    const r = await run();
    assert.equal(r.code, 4, `${prefix} exit 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.deepEqual(lines(r.stderr).filter((l) => l.startsWith(prefix)), [`${prefix} ${COMPARE(b.base, head, `${US2} does not parse at ${s7(b.base)}`)}`], `${prefix} the snapshot fault alone\n${r.stderr}`);
    unchanged(b, kb, prefix);
  }
});
