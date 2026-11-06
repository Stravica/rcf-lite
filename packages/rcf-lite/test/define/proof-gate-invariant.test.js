// Round G (US-19905): the gate invariant (the stage-keeper's ruling 48,
// the gate's F-2). rcf build verdict review and light Finalise refuse
// when a criterion is lighter at head than at the base (absent or full to
// journey or external, or journey to external) without a resolved
// decision in rcf/define/decisions-ledger.json naming that criterion and
// both levels, whatever wrote the lightening: a hand edit to the story
// JSON, a blueprint version replacement, any future writer. The base is
// the merge-base of HEAD with the first of origin/main and main that
// resolves (light Finalise's base). The decision that satisfies the gate
// has the shape the define update guard writes: blocks the criterion id,
// status resolved, question "Lighten <ac> proof from <from> to <to>?".
// Creations and tightenings stay silent.
//
// Criteria here: AC-19905-23 to AC-19905-26, each external. Each drives
// bin/rcf.js against a fixture project made by its own rcf init and
// committed to git: the base chain on main, then branch feature. Imports:
// Node builtins and test/_harness/ only (GR-40), so the file also loads in
// the packed-artefact run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, porcelain, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const US = 'rcf/user-stories/us-101.json';
const LEDGER = 'rcf/define/decisions-ledger.json';
const IDS = ['AC-101-1', 'AC-101-2', 'AC-101-3'];

// The one refusal line of each verb: every lightened criterion named with
// its level at the base and at head, in criterion id order.
const named = (items) => items.map(([acId, from, to]) => `${acId} from ${from} to ${to}`).join(', ');
const REVIEW_REFUSAL = (base, items) => `verdict refused: proof lightened since ${s7(base)} without a resolved decision in rcf/define/decisions-ledger.json: ${named(items)}`;
const FINALISE_REFUSAL = (base, items) => `finalise refused: proof lightened since ${s7(base)} without a resolved decision in rcf/define/decisions-ledger.json: ${named(items)}`;

const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

// The base chain on main: US-101 with authored criteria AC-101-1.. (each
// with the extra fields given), FBS-001 scoping them; then branch feature.
async function baseChain(t, extras, { name = 'gate' } = {}) {
  const dir = await project(t, { git: true, name });
  const ids = IDS.slice(0, extras.length);
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = extras.map((extra, i) => criterion(ids[i], `[happy] authored criterion ${i + 1}`, extra));
  });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ids; });
  const base = commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base, ids };
}

// A hand edit to the story JSON on the branch, committed: proof per id
// (null deletes the field).
function handEdit(dir, proofs, subject = 'DEFINE: hand edit') {
  editStory(dir, 'US-101', (us) => {
    for (const ac of us.acceptanceCriteria) {
      if (!(ac.id in proofs)) continue;
      if (proofs[ac.id] === null) delete ac.proof;
      else ac.proof = proofs[ac.id];
    }
  });
  return commit(dir, subject);
}

const MERGE = ['--code', 'MERGE', '--adequacy', 'PASS'];
const FINDINGS = ['--code', 'FINDINGS', '--adequacy', 'FINDINGS', '--finding', 'spec:-:a fixture finding'];
const review = (dir, acs, codes = MERGE) => rcf(['build', 'verdict', 'review', '--fbs', 'FBS-001', '--acs', acs.join(','), ...codes], { cwd: dir });

// The review refusal: exit 4, the one stated line, no review.json for
// HEAD and git status unchanged.
async function assertReviewRefused(dir, acs, line, codes = MERGE) {
  const before = porcelain(dir);
  const rel = verdictPath(sha(dir), 'review.json');
  const r = await review(dir, acs, codes);
  assert.equal(r.code, 4, `build verdict review exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  errHas(r, line);
  assert.equal(existsSync(join(dir, rel)), false, `no ${rel} is written`);
  assert.equal(porcelain(dir), before, 'git status --porcelain is unchanged');
}

async function assertReviewWritten(dir, acs) {
  const r = await review(dir, acs);
  assert.equal(r.code, 0, `build verdict review exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(existsSync(join(dir, verdictPath(sha(dir), 'review.json'))), 'review.json for HEAD is written');
}

async function rcfOk(dir, args) {
  const r = await rcf(args, { cwd: dir });
  assert.equal(r.code, 0, `${args.join(' ')} exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

// The resolved decision a hand records through the ledger verbs, in the
// guard's shape, then commits.
async function decide(dir, acId, from, to, reason) {
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'add',
    '--question', `Lighten ${acId} proof from ${from} to ${to}?`,
    '--option', `a:lighten ${acId} proof from ${from} to ${to}`,
    '--option', `b:keep ${acId} proof at ${from}`,
    '--default', 'b', '--blocks', acId]);
  const list = JSON.parse((await rcfOk(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;
  const id = list.at(-1).id;
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'resolve', String(id), '--answer', reason]);
  return commit(dir, `DEFINE: decide ${acId}`);
}

test('AC-19905-23: a hand edit committed after the base lightening an authored criterion from no proof to external, from journey to external, or two criteria at once, with no decision, makes rcf build verdict review exit 4 with the one stated line naming each criterion and both levels, and write no review.json', async (t) => {
  const a = await baseChain(t, [{}], { name: 'gate-full' });
  handEdit(a.dir, { 'AC-101-1': 'external' });
  await assertReviewRefused(a.dir, a.ids, REVIEW_REFUSAL(a.base, [['AC-101-1', 'full', 'external']]));

  const b = await baseChain(t, [{ proof: 'journey' }], { name: 'gate-journey' });
  handEdit(b.dir, { 'AC-101-1': 'external' });
  await assertReviewRefused(b.dir, b.ids, REVIEW_REFUSAL(b.base, [['AC-101-1', 'journey', 'external']]));

  const c = await baseChain(t, [{}, { proof: 'journey' }, {}], { name: 'gate-two' });
  handEdit(c.dir, { 'AC-101-1': 'journey', 'AC-101-2': 'external' });
  await assertReviewRefused(c.dir, c.ids, REVIEW_REFUSAL(c.base, [['AC-101-1', 'full', 'journey'], ['AC-101-2', 'journey', 'external']]));
  // Only a passing verdict is refused: a FINDINGS verdict is recorded while the lightening stands undecided (ruling 51).
  const findings = await review(c.dir, c.ids, FINDINGS);
  const rel = verdictPath(sha(c.dir), 'review.json');
  assert.equal(findings.code, 0, `build verdict review FINDINGS/FINDINGS exits 0\nstdout:\n${findings.stdout}\nstderr:\n${findings.stderr}`);
  assert.ok(lines(findings.stdout).includes(`verdict: review FINDINGS/FINDINGS at ${s7(sha(c.dir))} written to ${rel}`), `stdout names the written verdict\nstdout:\n${findings.stdout}`);
  assert.ok(existsSync(join(c.dir, rel)), `${rel} for HEAD is written`);
});

// ------------------------------------------------- light Finalise fixture

// The round of test/cli/finalise-verdicts.test.js, reaching every check
// before this one: the base chain on main (US-101 with AC-101-1 and
// AC-101-2 bound to resolving tests, FBS-001 notStarted), then on branch
// feature a DEFINE: commit marking FBS-001 inProgress (and `edit`), a
// BUILD: commit with a Code Node per criterion (H), REVIEW: MERGE/PASS at
// H touching both, and TEST: PASS at H with a passing test-strength record.
const BOTH = ['AC-101-1', 'AC-101-2'];
const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds' };
const SYMBOL = { 'AC-101-1': 'first', 'AC-101-2': 'second' };

async function finaliseRound(t, { edit } = {}) {
  const dir = await project(t, { name: 'gate-fin' });
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
  if (edit) edit(dir);
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

const finalise = (dir) => rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });

test('AC-19905-24: in a round that reaches every earlier Finalise check, a DEFINE: hand edit lightening AC-101-1 from no proof to external, or AC-101-1 to journey and AC-101-2 to external, with no decision makes rcf build finalise exit 4 with the one stated line naming each criterion and both levels, and leaves rcf/fbs/fbs-001.json byte-identical', async (t) => {
  const cases = [
    [{ 'AC-101-1': 'external' }, [['AC-101-1', 'full', 'external']]],
    [{ 'AC-101-1': 'journey', 'AC-101-2': 'external' }, [['AC-101-1', 'full', 'journey'], ['AC-101-2', 'full', 'external']]],
  ];
  for (const [proofs, items] of cases) {
    const { dir, base } = await finaliseRound(t, {
      edit: (d) => editStory(d, 'US-101', (us) => { for (const ac of us.acceptanceCriteria) if (proofs[ac.id]) ac.proof = proofs[ac.id]; }),
    });
    const fbs = readText(dir, 'rcf/fbs/fbs-001.json');
    const st = porcelain(dir);
    const r = await finalise(dir);
    assert.equal(r.code, 4, `build finalise exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    errHas(r, FINALISE_REFUSAL(base, items));
    assert.equal(readText(dir, 'rcf/fbs/fbs-001.json'), fbs, 'rcf/fbs/fbs-001.json is byte-identical');
    assert.equal(readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus, 'inProgress', 'complete is not written');
    assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged');
  }
});

// --------------------------------------------------- blueprint fixture

// A blueprint source outside the project (so the fixture tree stays
// clean): slug spa at `version`, contributing spa-REQ-001 and spa-US-101
// whose AC-999-1 carries `proof` (none when undefined).
function blueprint(t, version, proof) {
  const dir = join(scratch(t, 'rcf-h-bp-'), `spa-${version}`);
  mkdirSync(join(dir, 'contributions'), { recursive: true });
  writeJson(dir, 'blueprint.json', {
    slug: 'spa', version,
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json' },
      { kind: 'us', id: 'spa-US-101', path: 'spa-us-101.json' },
    ],
  });
  writeJson(dir, 'contributions/spa-req-001.json', {
    reqId: 'spa-REQ-001', prdId: 'PRD-001', title: 'A requirement', description: 'A description', category: 'functional',
    priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft', createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  });
  writeJson(dir, 'contributions/spa-us-101.json', {
    usId: 'spa-US-101', prdId: 'PRD-001', reqId: 'spa-REQ-001', version: '0.1.0', status: 'draft',
    title: 'US', asA: 'a', iWant: 'b', soThat: 'c',
    acceptanceCriteria: [criterion('AC-999-1', '[happy] blueprint criterion', proof ? { proof } : {})],
    tacIds: [], createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  });
  return dir;
}

test('AC-19905-25: with the refusal shown first, a resolved decision added through rcf define ledger decisions add and resolve, in the guard shape, and committed lets rcf build verdict review exit 0; and a blueprint version replacement lightening AC-999-1 with --reason, which writes that decision, lets the review verdict exit 0', async (t) => {
  const a = await baseChain(t, [{}], { name: 'gate-decided' });
  handEdit(a.dir, { 'AC-101-1': 'external' });
  await assertReviewRefused(a.dir, a.ids, REVIEW_REFUSAL(a.base, [['AC-101-1', 'full', 'external']]));
  await decide(a.dir, 'AC-101-1', 'full', 'external', 'the release Verify proves it');
  await assertReviewWritten(a.dir, a.ids);

  const dir = await project(t, { git: true, name: 'gate-bp' });
  await rcfOk(dir, ['define', 'blueprint', 'add', blueprint(t, '1.0.0')]);
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ['AC-101-1', 'AC-999-1']; });
  commit(dir, 'fixture: base chain with the blueprint');
  git(dir, 'switch', '-q', '-c', 'feature');
  await rcfOk(dir, ['define', 'blueprint', 'add', blueprint(t, '2.0.0', 'external'), '--reason', 'the release Verify proves it']);
  const list = JSON.parse((await rcfOk(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;
  const mine = list.filter((d) => d.blocks === 'AC-999-1');
  assert.equal(mine.length, 1, `the replacement wrote one decision for AC-999-1\n${JSON.stringify(list, null, 2)}`);
  assert.equal(mine[0].status, 'resolved');
  assert.equal(mine[0].question, 'Lighten AC-999-1 proof from full to external?');
  commit(dir, 'DEFINE: blueprint 2.0.0');
  await assertReviewWritten(dir, ['AC-101-1', 'AC-999-1']);
});

test('AC-19905-26: with a refusal on a lightened criterion shown first, a criterion new at head at journey or external and tightenings (external to journey, journey to full) need no decision: once the lightening is decided rcf build verdict review exits 0, and the refusal never names the created or tightened criteria', async (t) => {
  const { dir, base } = await baseChain(t, [{}, { proof: 'external' }, { proof: 'journey' }], { name: 'gate-silent' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria[0].proof = 'external';
    us.acceptanceCriteria[1].proof = 'journey';
    us.acceptanceCriteria[2].proof = 'full';
    us.acceptanceCriteria.push(criterion('AC-101-4', '[happy] created at journey', { proof: 'journey' }));
    us.acceptanceCriteria.push(criterion('AC-101-5', '[happy] created at external', { proof: 'external' }));
  });
  const ids = [...IDS, 'AC-101-4', 'AC-101-5'];
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ids; });
  commit(dir, 'DEFINE: create, tighten and lighten');
  await assertReviewRefused(dir, ids, REVIEW_REFUSAL(base, [['AC-101-1', 'full', 'external']]));
  await decide(dir, 'AC-101-1', 'full', 'external', 'the release Verify proves it');
  await assertReviewWritten(dir, ids);
});
