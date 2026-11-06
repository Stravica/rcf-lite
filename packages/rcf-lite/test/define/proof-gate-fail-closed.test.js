// Round G (US-19905): the gate fails closed (the stage-keeper's rulings
// 58 and 59, the gate's F-1 and F-2). rcf build verdict review refuses a
// MERGE/PASS verdict when the base cannot be resolved (neither
// origin/main nor main), naming the reason as light Finalise already
// does; FINDINGS is still recorded. And the shared check counts a
// resolved decision only when its answer is non-empty: a decision with
// no answer, an empty answer or a whitespace-only answer leaves the
// lightening undecided at the review gate and at light Finalise, and the
// refusal names the criterion and says the answer is missing.
//
// Criteria here: AC-19905-31 to AC-19905-34, each external. Each drives
// bin/rcf.js against a fixture project made by its own rcf init and
// committed to git. Imports: Node builtins and test/_harness/ only
// (GR-40), so the file also loads in the packed-artefact run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, gitTry, porcelain, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const LEDGER = 'rcf/define/decisions-ledger.json';
const IDS = ['AC-101-1', 'AC-101-2'];

// The one refusal line of each verb. An item is [acId, from, to] or
// [acId, from, to, true] when its resolved decision has no answer.
const named = (items) => items.map(([acId, from, to, answerless]) => `${acId} from ${from} to ${to}${answerless ? ' (answer missing)' : ''}`).join(', ');
const REVIEW_REFUSAL = (base, items) => `verdict refused: proof lightened since ${s7(base)} without a resolved decision in rcf/define/decisions-ledger.json: ${named(items)}`;
const FINALISE_REFUSAL = (base, items) => `finalise refused: proof lightened since ${s7(base)} without a resolved decision in rcf/define/decisions-ledger.json: ${named(items)}`;
const NO_BASE = 'verdict refused: no merge-base with origin/main or main';

const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

// The base chain on main: US-101 with authored criteria AC-101-1..
// (no proof), FBS-001 scoping them; then branch feature.
async function baseChain(t, n, { name = 'closed' } = {}) {
  const dir = await project(t, { git: true, name });
  const ids = IDS.slice(0, n);
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = ids.map((id, i) => criterion(id, `[happy] authored criterion ${i + 1}`));
  });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ids; });
  const base = commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base, ids };
}

function lighten(dir, proofs) {
  editStory(dir, 'US-101', (us) => {
    for (const ac of us.acceptanceCriteria) if (proofs[ac.id]) ac.proof = proofs[ac.id];
  });
}

const MERGE = ['--code', 'MERGE', '--adequacy', 'PASS'];
const FINDINGS = ['--code', 'FINDINGS', '--adequacy', 'FINDINGS', '--finding', 'spec:-:a fixture finding'];
const review = (dir, acs, codes = MERGE) => rcf(['build', 'verdict', 'review', '--fbs', 'FBS-001', '--acs', acs.join(','), ...codes], { cwd: dir });

// The review refusal: exit 4, the one stated line, no review.json for
// HEAD and git status unchanged.
async function assertReviewRefused(dir, acs, line) {
  const before = porcelain(dir);
  const rel = verdictPath(sha(dir), 'review.json');
  const r = await review(dir, acs);
  assert.equal(r.code, 4, `build verdict review MERGE/PASS exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  errHas(r, line);
  assert.equal(existsSync(join(dir, rel)), false, `no ${rel} is written`);
  assert.equal(porcelain(dir), before, 'git status --porcelain is unchanged');
}

async function assertReviewWritten(dir, acs, codes = MERGE) {
  const r = await review(dir, acs, codes);
  assert.equal(r.code, 0, `build verdict review exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(existsSync(join(dir, verdictPath(sha(dir), 'review.json'))), 'review.json for HEAD is written');
}

async function rcfOk(dir, args) {
  const r = await rcf(args, { cwd: dir });
  assert.equal(r.code, 0, `${args.join(' ')} exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

const decisions = async (dir) => JSON.parse((await rcfOk(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;

// A decision in the guard's shape through the ledger verbs, resolved
// with `answer` as given: undefined passes no --answer, a string passes
// --answer <string> (empty and whitespace-only included). Returns its id.
async function resolveDecision(dir, acId, from, to, answer) {
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'add',
    '--question', `Lighten ${acId} proof from ${from} to ${to}?`,
    '--option', `a:lighten ${acId} proof from ${from} to ${to}`,
    '--option', `b:keep ${acId} proof at ${from}`,
    '--default', 'b', '--blocks', acId]);
  const id = (await decisions(dir)).at(-1).id;
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'resolve', String(id), ...(answer === undefined ? [] : ['--answer', answer])]);
  return id;
}

// The Givens for an answerless decision (Step 1 (b) of the pass): no
// --answer, --answer "" (both leave no answer field), a hand edit of the
// ledger setting answer to the empty string, and --answer "   ".
const ANSWERLESS = [
  ['no --answer', undefined, null],
  ['an empty --answer', '', null],
  ['a hand-edited empty answer', undefined, ''],
  ['a whitespace-only answer', '   ', null],
];

async function answerless(dir, acId, [, answer, handEdited]) {
  const id = await resolveDecision(dir, acId, 'full', 'external', answer);
  if (handEdited !== null) {
    const body = readJson(dir, LEDGER);
    body.decisions.find((d) => d.id === id).answer = handEdited;
    writeJson(dir, LEDGER, body);
  }
  const mine = (await decisions(dir)).find((d) => d.id === id);
  assert.equal(mine.status, 'resolved', 'the decision is resolved');
  assert.ok(!(typeof mine.answer === 'string' && mine.answer.trim()), `the decision carries no non-empty answer\n${JSON.stringify(mine)}`);
}

// ------------------------------------------------------------- no base

test('AC-19905-31: in a git fixture whose only branch is renamed after the base commit so neither origin/main nor main resolves, rcf build verdict review MERGE/PASS exits 4 naming no merge-base with origin/main or main and writes no review.json, with no lightening and with a hand lightening and no decision; FINDINGS/FINDINGS exits 0 and writes review.json', async (t) => {
  const dir = await project(t, { git: true, name: 'nobase' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = [criterion('AC-101-1', '[happy] authored criterion 1')]; });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ['AC-101-1']; });
  commit(dir, 'fixture: base chain');
  git(dir, 'branch', '-m', 'main', 'feature');
  for (const ref of ['origin/main', 'main']) assert.notEqual(gitTry(dir, 'rev-parse', '--verify', '-q', ref).code, 0, `${ref} does not resolve`);
  await assertReviewRefused(dir, ['AC-101-1'], NO_BASE);

  lighten(dir, { 'AC-101-1': 'external' });
  commit(dir, 'DEFINE: hand edit');
  await assertReviewRefused(dir, ['AC-101-1'], NO_BASE);

  // FINDINGS is still recorded with no base (ruling 58).
  await assertReviewWritten(dir, ['AC-101-1'], FINDINGS);
});

// ------------------------------------------------- answerless at review

test('AC-19905-32: a hand lightening of AC-101-1 from no proof to external whose resolved decision has no answer (resolved with no --answer, with an empty --answer, or hand-edited to an empty answer) or a whitespace-only answer makes rcf build verdict review MERGE/PASS exit 4 with the one stated line naming the criterion, both levels and the missing answer, and write no review.json; beside an undecided lightening of AC-101-2 both are named in criterion id order', async (t) => {
  for (const given of ANSWERLESS) {
    const { dir, base, ids } = await baseChain(t, 1, { name: `answerless-${ANSWERLESS.indexOf(given)}` });
    lighten(dir, { 'AC-101-1': 'external' });
    await answerless(dir, 'AC-101-1', given);
    commit(dir, `DEFINE: lighten AC-101-1 with ${given[0]}`);
    await assertReviewRefused(dir, ids, REVIEW_REFUSAL(base, [['AC-101-1', 'full', 'external', true]]));
  }

  const { dir, base, ids } = await baseChain(t, 2, { name: 'answerless-mixed' });
  lighten(dir, { 'AC-101-1': 'external', 'AC-101-2': 'external' });
  await answerless(dir, 'AC-101-1', ANSWERLESS[0]);
  commit(dir, 'DEFINE: lighten both, decide one with no answer');
  await assertReviewRefused(dir, ids, REVIEW_REFUSAL(base, [['AC-101-1', 'full', 'external', true], ['AC-101-2', 'full', 'external']]));
});

// ------------------------------------------- answerless at light Finalise

// The round of test/define/proof-gate-invariant.test.js (AC-19905-24),
// reaching every check before this one: the base chain on main (US-101
// with AC-101-1 and AC-101-2 bound to resolving tests, FBS-001
// notStarted), then on branch feature a DEFINE: commit marking FBS-001
// inProgress (and `edit`), a BUILD: commit with a Code Node per criterion
// (H), REVIEW: MERGE/PASS at H touching both, and TEST: PASS at H with a
// passing test-strength record.
const BOTH = ['AC-101-1', 'AC-101-2'];
const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds' };
const SYMBOL = { 'AC-101-1': 'first', 'AC-101-2': 'second' };

async function finaliseRound(t, { edit, name = 'closed-fin' } = {}) {
  const dir = await project(t, { name });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = BOTH.map((id) => criterion(id, `[happy] ${NAMES[id]}`, { given: 'a fixture project', when: 'the fixture runs', then: NAMES[id], verification: 'external' }));
  });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'notStarted'; });
  bindTests(dir, BOTH.map((acId) => ({ acId, pointer: `test/rcf/a.test.js::${NAMES[acId]}` })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  git(dir, 'init', '-q', '-b', 'main');
  const base = commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'inProgress'; f.summary = `${f.summary} Round opened.`; });
  if (edit) await edit(dir);
  commit(dir, 'DEFINE: round');
  const files = { 'src/x.js': 'export function first() { return 1; }\nexport function second() { return 2; }\n' };
  for (const acId of BOTH) {
    const n = acId.slice(-1);
    files[`rcf/code-nodes/cn-00${n}.json`] = {
      cnId: `CN-00${n}`, path: `src/x.js#${SYMBOL[acId]}`, title: `fixture node for ${acId}`, description: `Fixture Code Node implementing ${acId}.`,
      implementsAcIds: [acId], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
  }
  const H = commit(dir, 'BUILD: code', files);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { base: git(dir, 'merge-base', 'main', H), touchedAcIds: BOTH }) });
  commit(dir, 'TEST: verdict', {
    [verdictPath(H, 'test.json')]: testVerdict(H),
    [verdictPath(H, 'test-strength.json')]: testStrengthReport(H, { passing: BOTH }),
  });
  return { dir, base, H };
}

test('AC-19905-33: in a round that reaches every earlier Finalise check, a DEFINE: hand edit lightening AC-101-1 from no proof to external with a resolved decision that has no answer or a whitespace-only answer makes rcf build finalise exit 4 with the one stated line naming the criterion and the missing answer, and leaves rcf/fbs/fbs-001.json byte-identical', async (t) => {
  for (const given of [ANSWERLESS[0], ANSWERLESS[3]]) {
    const { dir, base } = await finaliseRound(t, {
      name: `closed-fin-${ANSWERLESS.indexOf(given)}`,
      edit: async (d) => {
        lighten(d, { 'AC-101-1': 'external' });
        await answerless(d, 'AC-101-1', given);
      },
    });
    const fbs = readText(dir, 'rcf/fbs/fbs-001.json');
    const st = porcelain(dir);
    const r = await rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });
    assert.equal(r.code, 4, `build finalise exits 4 (${given[0]})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    errHas(r, FINALISE_REFUSAL(base, [['AC-101-1', 'full', 'external', true]]));
    assert.equal(readText(dir, 'rcf/fbs/fbs-001.json'), fbs, 'rcf/fbs/fbs-001.json is byte-identical');
    assert.equal(readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus, 'inProgress', 'complete is not written');
    assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged');
  }
});

// ---------------------------------------------------- a non-empty answer

test('AC-19905-34: with the answerless refusal shown first, a decision resolved with a non-empty --answer and committed lets rcf build verdict review exit 0 and write review.json for HEAD', async (t) => {
  const { dir, base, ids } = await baseChain(t, 1, { name: 'answered' });
  lighten(dir, { 'AC-101-1': 'external' });
  await answerless(dir, 'AC-101-1', ANSWERLESS[0]);
  commit(dir, 'DEFINE: lighten AC-101-1 with no answer');
  await assertReviewRefused(dir, ids, REVIEW_REFUSAL(base, [['AC-101-1', 'full', 'external', true]]));
  await resolveDecision(dir, 'AC-101-1', 'full', 'external', 'the release Verify proves it');
  commit(dir, 'DEFINE: decide AC-101-1 with an answer');
  await assertReviewWritten(dir, ids);
});
