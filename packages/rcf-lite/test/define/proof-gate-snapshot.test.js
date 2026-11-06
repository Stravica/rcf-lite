// Round G (US-19905): the gate's story discovery from two complete
// snapshots (the stage-keeper's rulings 62 and 64 to 69, re-review 3
// F-1, F-2 and F-6). rcf build verdict review (MERGE/PASS) and light
// Finalise judge one criterion snapshot of the base tree (the merge-base
// of HEAD with the first of origin/main and main) against one of the
// judged head (HEAD for the review verb, the reviewed head for light
// Finalise). Each snapshot holds every story file the walker would load
// (the direct *.json entries of rcf/user-stories/), read from the tree by
// a NUL-delimited listing and blob reads, and is compared by criterion id,
// so renaming, moving or splitting story files, or a path spelling Git
// C-quotes, cannot change the outcome. A snapshot that cannot be built
// completely (a symlink or gitlink under the story root, a blob that
// cannot be read, a story that will not parse, a criterion id declared
// twice) or a base criterion absent at head fails closed. A retired
// criterion's successor is compared with the predecessor's base level,
// and a criterion retired with no successor needs a resolved decision
// "Retire <ac> with no successor?" blocking it. A dirty working tree
// refuses the review verb (today's refusal, pinned) and light Finalise.
//
// Criteria here: AC-19905-35 to AC-19905-49, each external. One fixture
// round per case (the round of test/define/proof-gate-invariant.test.js's
// AC-19905-24, reaching every earlier Finalise check): the base chain on
// main, then on branch feature a DEFINE: commit carrying the case's edit,
// a BUILD: commit with a Code Node per criterion (the reviewed head H),
// REVIEW: MERGE/PASS at H and TEST: PASS at H. The review verb runs at
// HEAD of that round, then light Finalise. Imports: Node builtins and
// test/_harness/ only (GR-40); no git worktree (ruling 61).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, porcelain, s7, sha } from '../_harness/git.js';
import { criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const ROOT = 'rcf/user-stories';
const US = `${ROOT}/us-101.json`;
const SPA = `${ROOT}/spa-us-101.json`;
const FBS = 'rcf/fbs/fbs-001.json';
const LEDGER = 'rcf/define/decisions-ledger.json';
const BOTH = ['AC-101-1', 'AC-101-2'];

const LIGHTER = (base, items) => `proof lightened since ${s7(base)} without a resolved decision in ${LEDGER}: ${items}`;
const COMPARE = (base, head, reason) => `cannot compare the criteria at ${s7(base)} and ${s7(head)}: ${reason}`;
const DIRTY_REVIEW = 'verdict refused: working tree is dirty; a verdict names a committed head';
const DIRTY_FINALISE = 'finalise refused: working tree is dirty; finalise judges a committed head';

const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

const ac = (id, extra = {}) => criterion(id, `[happy] fixture criterion ${id}`, { given: 'a fixture project', when: 'the fixture runs', then: `${id} holds`, verification: 'external', ...extra });
const sym = (id) => `c${id.replace(/\D+/g, '_')}`;
const at = (dir, rel) => join(dir, rel);

// Edit the criteria of the story file at rel (a function of the array).
function criteria(dir, rel, fn) {
  const doc = readJson(dir, rel);
  doc.acceptanceCriteria = fn(doc.acceptanceCriteria) ?? doc.acceptanceCriteria;
  writeJson(dir, rel, doc);
}
const setProof = (dir, rel, id, proof) => criteria(dir, rel, (acs) => acs.map((a) => (a.id === id ? { ...a, proof } : a)));
const retire = (dir, id, by) => criteria(dir, US, (acs) => acs.map((a) => (a.id === id ? { ...a, supersededBy: by, supersededOn: '2026-11-06', supersessionNote: `fixture: ${id} retired` } : a)));
const touch = (dir) => editStory(dir, 'US-101', (us) => { us.acceptanceCriteria[0].description = `${us.acceptanceCriteria[0].description} Amended.`; });

async function rcfOk(dir, args) {
  const r = await rcf(args, { cwd: dir });
  assert.equal(r.code, 0, `${args.join(' ')} exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

// A decision added and resolved through the ledger verbs (uncommitted; the
// round's DEFINE: commit carries it). answer null resolves with no --answer.
async function decide(dir, question, blocks, answer = 'the stage-keeper ruled it') {
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'add', '--question', question, '--option', 'a:yes', '--option', 'b:no', '--default', 'b', '--blocks', blocks]);
  const list = JSON.parse((await rcfOk(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;
  await rcfOk(dir, ['define', 'ledger', 'decisions', 'resolve', String(list.at(-1).id), ...(answer === null ? [] : ['--answer', answer])]);
}
const lighten = (dir, id, from, to, answer) => decide(dir, `Lighten ${id} proof from ${from} to ${to}?`, id, answer);
const drop = (dir, id, answer) => decide(dir, `Retire ${id} with no successor?`, id, answer);

// A clean filter in the fixture's own git config: the blob committed for
// rel is the filter's output, while the working copy (which the walker
// reads) stays as written. kind 'dup' declares the first criterion twice;
// kind 'broken' is not JSON.
function cleanFilter(t, dir, rel, kind) {
  const script = join(scratch(t, 'rcf-h-filter-'), `${kind}.cjs`);
  writeFileSync(script, kind === 'dup'
    ? "let s='';process.stdin.on('data',(d)=>{s+=d;}).on('end',()=>{const doc=JSON.parse(s);doc.acceptanceCriteria.push(doc.acceptanceCriteria[0]);process.stdout.write(JSON.stringify(doc,null,2)+'\\n');});\n"
    : "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('{ not json\\n');});\n");
  git(dir, 'config', `filter.${kind}.clean`, `"${process.execPath}" "${script}"`);
  writeText(dir, `${ROOT}/.gitattributes`, `${rel.slice(ROOT.length + 1)} filter=${kind}\n`);
  touch(dir);
}

// Remove the loose object of rel at rev from the object store.
function dropBlob(dir, rev, rel) {
  const oid = git(dir, 'rev-parse', `${rev}:${rel}`);
  rmSync(join(dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
}

// The fixture round. base(ctx) edits the base chain before its commit (the
// repository exists); define(ctx) edits the branch before the DEFINE:
// commit; post(ctx) runs after the TEST: commit. acIds is FBS-001's scope
// at head and every criterion the verdicts touch.
async function round(t, { name = 'snap', base, define, post, acIds = BOTH } = {}) {
  const dir = await project(t, { name });
  const tpl = readJson(dir, US);
  const ctx = { t, dir, story: (usId, acs) => ({ ...tpl, usId, title: `story ${usId}`, acceptanceCriteria: acs }) };
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = BOTH.map((id) => ac(id)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'notStarted'; });
  writeText(dir, '.gitignore', 'node_modules/\n');
  git(dir, 'init', '-q', '-b', 'main');
  if (base) await base(ctx);
  ctx.base = commit(dir, 'fixture: base chain');
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
  commit(dir, 'REVIEW: verdict', { [verdictPath(ctx.H, 'review.json')]: reviewVerdict(ctx.H, { touchedAcIds: acIds }) });
  commit(dir, 'TEST: verdict', {
    [verdictPath(ctx.H, 'test.json')]: testVerdict(ctx.H),
    [verdictPath(ctx.H, 'test-strength.json')]: testStrengthReport(ctx.H, { passing: acIds }),
  });
  if (post) await post(ctx);
  return { ...ctx, acIds };
}

const MERGE = ['--code', 'MERGE', '--adequacy', 'PASS'];
const FINDINGS = ['--code', 'FINDINGS', '--adequacy', 'FINDINGS', '--finding', 'spec:-:a fixture finding'];
const review = (rnd, codes) => rcf(['build', 'verdict', 'review', '--fbs', 'FBS-001', '--acs', rnd.acIds.join(','), ...codes], { cwd: rnd.dir });
const finalise = (rnd) => rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: rnd.dir });

// Both verbs refuse with the one line (rest(head) after the verb's prefix,
// head the judged head: HEAD for review, H for Finalise), exit 4, writing
// nothing; a FINDINGS/FINDINGS review verdict is still written (ruling 51).
async function refusedBoth(rnd, rest) {
  const { dir } = rnd;
  const head = sha(dir);
  const rel = verdictPath(head, 'review.json');
  const st = porcelain(dir);
  const fbs = readText(dir, FBS);
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 4, `build verdict review MERGE/PASS exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  errHas(r, `verdict refused: ${rest(head)}`);
  assert.equal(existsSync(at(dir, rel)), false, `no ${rel} is written`);
  assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged after the review refusal');
  const f = await review(rnd, FINDINGS);
  assert.equal(f.code, 0, `build verdict review FINDINGS/FINDINGS exits 0\nstdout:\n${f.stdout}\nstderr:\n${f.stderr}`);
  assert.ok(existsSync(at(dir, rel)), `FINDINGS writes ${rel}`);
  rmSync(at(dir, rel));
  const n = await finalise(rnd);
  assert.equal(n.code, 4, `build finalise exits 4\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
  errHas(n, `finalise refused: ${rest(rnd.H)}`);
  assert.equal(readText(dir, FBS), fbs, 'rcf/fbs/fbs-001.json is byte-identical');
  assert.equal(porcelain(dir), st, 'git status --porcelain is unchanged after the Finalise refusal');
}

// Both verbs pass: the review verb writes MERGE/PASS for HEAD, and light
// Finalise exits 0 writing complete (review only with finalise: false).
async function passedBoth(rnd, { finalise: fin = true } = {}) {
  const { dir } = rnd;
  const rel = verdictPath(sha(dir), 'review.json');
  const r = await review(rnd, MERGE);
  assert.equal(r.code, 0, `build verdict review MERGE/PASS exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(existsSync(at(dir, rel)), `${rel} is written`);
  rmSync(at(dir, rel));
  if (!fin) return;
  const n = await finalise(rnd);
  assert.equal(n.code, 0, `build finalise exits 0\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
  assert.equal(readJson(dir, FBS).executionStatus, 'complete', 'complete is written');
}

const lightened = (rnd, items) => (_head) => LIGHTER(rnd.base, items);
const cannot = (rnd, reason) => (head) => COMPARE(rnd.base, head, reason(head));

// ------------------------------------------------------------ the cases

const QUOTED = `${ROOT}/us-101-"q.json`;
const quoted = (decision) => ({
  base: ({ dir }) => renameSync(at(dir, US), at(dir, QUOTED)),
  define: async ({ dir }) => {
    renameSync(at(dir, QUOTED), at(dir, US));
    setProof(dir, US, 'AC-101-1', 'external');
    if (decision) await lighten(dir, 'AC-101-1', 'full', 'external');
  },
});

// A rename, a move into an existing story file and a split into a new
// one, each lightening one criterion from full to external in the same
// commit (lightened: false keeps every level).
function layouts({ lightened: light = true, decision = false } = {}) {
  const proof = light ? { proof: 'external' } : {};
  const decided = async (dir, id) => { if (light && decision) await lighten(dir, id, 'full', 'external'); };
  return [
    ['rename', 'AC-101-1', {
      define: async ({ dir }) => {
        renameSync(at(dir, US), at(dir, `${ROOT}/checkout-us-101.json`));
        const doc = readJson(dir, `${ROOT}/checkout-us-101.json`);
        writeJson(dir, `${ROOT}/checkout-us-101.json`, { ...doc, usId: 'checkout-US-101' });
        if (light) setProof(dir, `${ROOT}/checkout-us-101.json`, 'AC-101-1', 'external');
        await decided(dir, 'AC-101-1');
      },
    }],
    ['move', 'AC-101-2', {
      acIds: [...BOTH, 'AC-101-3'],
      base: ({ dir, story }) => writeJson(dir, SPA, story('spa-US-101', [ac('AC-101-3')])),
      define: async ({ dir }) => {
        criteria(dir, US, (acs) => acs.filter((a) => a.id !== 'AC-101-2'));
        criteria(dir, SPA, (acs) => [ac('AC-101-2', proof), ...acs]);
        await decided(dir, 'AC-101-2');
      },
    }],
    ['split', 'AC-101-2', {
      define: async ({ dir, story }) => {
        criteria(dir, US, (acs) => acs.filter((a) => a.id !== 'AC-101-2'));
        writeJson(dir, SPA, story('spa-US-101', [ac('AC-101-2', proof)]));
        await decided(dir, 'AC-101-2');
      },
    }],
  ];
}

const shadow = (decision) => ({
  define: async ({ dir }) => {
    mkdirSync(at(dir, `${ROOT}/zz`), { recursive: true });
    copyFileSync(at(dir, US), at(dir, `${ROOT}/zz/shadow.json`));
    setProof(dir, US, 'AC-101-1', 'external');
    if (decision) {
      writeText(dir, `${ROOT}/zz/broken.json`, '{ not json\n');
      writeText(dir, `${ROOT}/notes.txt`, 'not a story\n');
      await lighten(dir, 'AC-101-1', 'full', 'external');
    }
  },
});

// AC-101-2 at baseProof on main; on the branch retired with supersededBy
// AC-101-3, created at successorProof (undefined: no proof field).
const succeeded = (baseProof, successorProof, decision) => ({
  acIds: [...BOTH, 'AC-101-3'],
  base: ({ dir }) => { if (baseProof) setProof(dir, US, 'AC-101-2', baseProof); },
  define: async ({ dir }) => {
    retire(dir, 'AC-101-2', 'AC-101-3');
    criteria(dir, US, (acs) => [...acs, ac('AC-101-3', successorProof ? { proof: successorProof } : {})]);
    if (decision) await lighten(dir, 'AC-101-3', baseProof ?? 'full', successorProof ?? 'full');
  },
});

// AC-101-2 at baseProof on main; on the branch retired with supersededBy
// naming no criterion at head (or itself, by: 'AC-101-2').
const orphaned = (baseProof, { by = 'AC-101-9', decision = false, answer } = {}) => ({
  base: ({ dir }) => { if (baseProof) setProof(dir, US, 'AC-101-2', baseProof); },
  define: async ({ dir }) => {
    retire(dir, 'AC-101-2', by);
    if (decision) await drop(dir, 'AC-101-2', answer);
  },
});

// ------------------------------------------------------------ the tests

test('AC-19905-35: a base story at a path Git C-quotes (us-101-"q.json), renamed at head to us-101.json with AC-101-1 lightened from no proof to external in the same commit and no decision, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one lightening line naming AC-101-1, writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, { name: 'snap-quoted', ...quoted(false) });
  await refusedBoth(rnd, lightened(rnd, 'AC-101-1 from full to external'));
});

test('AC-19905-36: a story file renamed (us-101.json to checkout-us-101.json), a criterion moved into an existing story file and a story split into a new file, each lightening one criterion from no proof to external in the same commit with no decision, make rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one lightening line naming that criterion, writing nothing; FINDINGS is still recorded', async (t) => {
  for (const [kind, id, opts] of layouts()) {
    const rnd = await round(t, { name: `snap-${kind}`, ...opts });
    await refusedBoth(rnd, lightened(rnd, `${id} from full to external`));
  }
});

test('AC-19905-37: the same rename, move and split with every criterion at its base level let rcf build verdict review MERGE/PASS exit 0 writing review.json and light Finalise exit 0 writing complete', async (t) => {
  for (const [kind, , opts] of layouts({ lightened: false })) {
    await passedBoth(await round(t, { name: `snap-${kind}-same`, ...opts }));
  }
});

test('AC-19905-38: a byte copy of the base us-101.json at rcf/user-stories/zz/shadow.json, which the walker does not load, does not hide AC-101-1 lightened from no proof to external in us-101.json with no decision: rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one lightening line naming AC-101-1, writing nothing; FINDINGS is still recorded', async (t) => {
  const rnd = await round(t, { name: 'snap-shadow', ...shadow(false) });
  await refusedBoth(rnd, lightened(rnd, 'AC-101-1 from full to external'));
});

test('AC-19905-39: a symlink or a gitlink under rcf/user-stories/, at head or at the base, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one cannot-compare line naming the path, its kind and the side, writing nothing; FINDINGS is still recorded', async (t) => {
  const link = `${ROOT}/us-102.json`;
  const vendored = `${ROOT}/vendored`;
  const cases = [
    ['head-symlink', US, 'symlink', 'head', {
      define: ({ dir }) => {
        const copy = readJson(dir, US);
        copy.acceptanceCriteria[0].proof = 'external';
        writeJson(dir, 'rcf/stories-src/us-101.json', copy);
        rmSync(at(dir, US));
        symlinkSync('../stories-src/us-101.json', at(dir, US));
      },
    }],
    ['base-symlink', link, 'symlink', 'base', {
      base: ({ dir }) => symlinkSync('us-101.json', at(dir, link)),
      define: ({ dir }) => rmSync(at(dir, link)),
    }],
    ['head-gitlink', vendored, 'gitlink', 'head', {
      define: ({ dir }) => {
        git(dir, 'update-index', '--add', '--cacheinfo', `160000,${sha(dir)},${vendored}`);
        mkdirSync(at(dir, vendored), { recursive: true });
      },
    }],
    ['base-gitlink', vendored, 'gitlink', 'base', {
      base: ({ dir }) => {
        git(dir, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},${vendored}`);
        mkdirSync(at(dir, vendored), { recursive: true });
      },
      define: ({ dir }) => {
        git(dir, 'rm', '-q', '--cached', vendored);
        rmSync(at(dir, vendored), { recursive: true, force: true });
      },
    }],
  ];
  for (const [name, path, kind, side, opts] of cases) {
    const rnd = await round(t, { name: `snap-${name}`, ...opts });
    await refusedBoth(rnd, cannot(rnd, (head) => `${path} is a ${kind} at ${s7(side === 'base' ? rnd.base : head)}`));
  }
});

test('AC-19905-40: a criterion id declared twice, at the base across two story files or in the committed head blob of us-101.json, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one cannot-compare line naming the id and the side, writing nothing; FINDINGS is still recorded', async (t) => {
  const a = await round(t, {
    name: 'snap-dup-base',
    base: ({ dir, story }) => writeJson(dir, SPA, story('spa-US-101', [ac('AC-101-1')])),
    define: ({ dir }) => rmSync(at(dir, SPA)),
  });
  await refusedBoth(a, cannot(a, () => `AC-101-1 is declared more than once at ${s7(a.base)}`));

  const b = await round(t, { name: 'snap-dup-head', define: ({ t: tt, dir }) => cleanFilter(tt, dir, US, 'dup') });
  await refusedBoth(b, cannot(b, (head) => `AC-101-1 is declared more than once at ${s7(head)}`));
});

test('AC-19905-41: a story file that will not parse, at the base (rcf/user-stories/us-102.json, removed at head) or in the committed head blob of us-101.json, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one cannot-compare line naming the path and the side, writing nothing; FINDINGS is still recorded', async (t) => {
  const bad = `${ROOT}/us-102.json`;
  const a = await round(t, {
    name: 'snap-parse-base',
    base: ({ dir }) => writeText(dir, bad, '{ "usId": "US-102",\n'),
    define: ({ dir }) => rmSync(at(dir, bad)),
  });
  await refusedBoth(a, cannot(a, () => `${bad} does not parse at ${s7(a.base)}`));

  const b = await round(t, { name: 'snap-parse-head', define: ({ t: tt, dir }) => cleanFilter(tt, dir, US, 'broken') });
  await refusedBoth(b, cannot(b, (head) => `${US} does not parse at ${s7(head)}`));
});

test('AC-19905-42: the blob of us-101.json missing from the object store, at the base or at head (the working copy intact), makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one cannot-compare line naming the path and the side, writing nothing; FINDINGS is still recorded', async (t) => {
  const a = await round(t, { name: 'snap-blob-base', define: ({ dir }) => touch(dir), post: ({ dir, base }) => dropBlob(dir, base, US) });
  await refusedBoth(a, cannot(a, () => `${US} cannot be read at ${s7(a.base)}`));

  const b = await round(t, { name: 'snap-blob-head', define: ({ dir }) => touch(dir), post: ({ dir, H }) => dropBlob(dir, H, US) });
  await refusedBoth(b, cannot(b, (head) => `${US} cannot be read at ${s7(head)}`));
});

test('AC-19905-43: a base criterion absent at head, deleted outright or deleted and re-added under a new id at external, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one cannot-compare line naming the deleted id, writing nothing; FINDINGS is still recorded', async (t) => {
  const cases = [
    ['deleted', ['AC-101-1'], []],
    ['re-added', ['AC-101-1', 'AC-101-3'], [ac('AC-101-3', { proof: 'external' })]],
  ];
  for (const [name, acIds, added] of cases) {
    const rnd = await round(t, {
      name: `snap-${name}`, acIds,
      define: ({ dir }) => criteria(dir, US, (acs) => [...acs.filter((a) => a.id !== 'AC-101-2'), ...added]),
    });
    await refusedBoth(rnd, cannot(rnd, (head) => `AC-101-2 is absent at ${s7(head)}`));
  }
});

test('AC-19905-44: AC-101-2 retired with supersededBy AC-101-3, a successor created at external while AC-101-2 was at no proof or journey at the base, with no decision, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one lightening line naming the successor and the predecessor base level, writing nothing; FINDINGS is still recorded', async (t) => {
  for (const from of [undefined, 'journey']) {
    const rnd = await round(t, { name: `snap-succ-${from ?? 'full'}`, ...succeeded(from, 'external', false) });
    await refusedBoth(rnd, lightened(rnd, `AC-101-3 from ${from ?? 'full'} to external`));
  }
});

test('AC-19905-45: AC-101-2 retired with supersededBy naming no criterion at head (or itself), at no proof, journey or external at the base, with no decision or with a decision resolved with no answer, makes rcf build verdict review MERGE/PASS and light Finalise exit 4 with the one lightening line naming AC-101-2 retired with no successor, writing nothing; FINDINGS is still recorded', async (t) => {
  const cases = [
    ['full', orphaned(undefined), ''],
    ['journey', orphaned('journey'), ''],
    ['external', orphaned('external'), ''],
    ['self', orphaned(undefined, { by: 'AC-101-2' }), ''],
    ['answerless', orphaned(undefined, { decision: true, answer: null }), ' (answer missing)'],
  ];
  for (const [name, opts, suffix] of cases) {
    const rnd = await round(t, { name: `snap-orphan-${name}`, ...opts });
    await refusedBoth(rnd, lightened(rnd, `AC-101-2 retired with no successor${suffix}`));
  }
});

test('AC-19905-46: criteria created at head with no predecessor at journey and at external, and a successor at the level of its predecessor or heavier, need no decision: rcf build verdict review MERGE/PASS exits 0 writing review.json and light Finalise exits 0 writing complete', async (t) => {
  const created = {
    acIds: [...BOTH, 'AC-101-3', 'AC-101-4'],
    define: ({ dir }) => criteria(dir, US, (acs) => [...acs, ac('AC-101-3', { proof: 'journey' }), ac('AC-101-4', { proof: 'external' })]),
  };
  await passedBoth(await round(t, { name: 'snap-new', ...created }));
  await passedBoth(await round(t, { name: 'snap-succ-heavier', ...succeeded('journey', undefined, false) }));
  await passedBoth(await round(t, { name: 'snap-succ-same', ...succeeded('journey', 'journey', false) }));
});

// The three dirty states, each outside rcf/verdicts/ and rcf/verify-reports/.
const DIRTY = [
  ['staged', ({ dir }) => { touch(dir); git(dir, 'add', US); }],
  ['unstaged', ({ dir }) => touch(dir)],
  ['untracked', ({ dir }) => writeText(dir, 'rcf/define/scratch.md', 'an uncommitted note\n')],
];

test('AC-19905-47: a staged, an unstaged or an untracked change outside rcf/verdicts/ and rcf/verify-reports/ makes rcf build verdict review exit 4 with "verdict refused: working tree is dirty; a verdict names a committed head" for MERGE/PASS and for FINDINGS/FINDINGS, writing no review.json and leaving git status --porcelain unchanged', async (t) => {
  for (const [name, post] of DIRTY) {
    const rnd = await round(t, { name: `snap-dirty-review-${name}`, post });
    const rel = verdictPath(sha(rnd.dir), 'review.json');
    const st = porcelain(rnd.dir);
    for (const codes of [MERGE, FINDINGS]) {
      const r = await review(rnd, codes);
      assert.equal(r.code, 4, `${name}: build verdict review ${codes[1]} exits 4\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
      errHas(r, DIRTY_REVIEW);
      assert.equal(existsSync(at(rnd.dir, rel)), false, `${name}: no ${rel} is written`);
      assert.equal(porcelain(rnd.dir), st, `${name}: git status --porcelain is unchanged`);
    }
  }
});

test('AC-19905-48: in a round that reaches every earlier light Finalise check, a staged, an unstaged or an untracked change outside rcf/verdicts/ and rcf/verify-reports/ makes rcf build finalise exit 4 with "finalise refused: working tree is dirty; finalise judges a committed head", leaving rcf/fbs/fbs-001.json byte-identical and git status --porcelain unchanged', async (t) => {
  for (const [name, post] of DIRTY) {
    const rnd = await round(t, { name: `snap-dirty-fin-${name}`, post });
    const st = porcelain(rnd.dir);
    const fbs = readText(rnd.dir, FBS);
    const n = await finalise(rnd);
    assert.equal(n.code, 4, `${name}: build finalise exits 4\nstdout:\n${n.stdout}\nstderr:\n${n.stderr}`);
    errHas(n, DIRTY_FINALISE);
    assert.equal(readText(rnd.dir, FBS), fbs, `${name}: rcf/fbs/fbs-001.json is byte-identical`);
    assert.equal(porcelain(rnd.dir), st, `${name}: git status --porcelain is unchanged`);
  }
});

test('AC-19905-49: with each matching decision resolved with a non-empty answer in the same DEFINE: commit, the C-quoted rename, the rename, move and split, the shadow copy (beside an unparseable zz/broken.json and a notes.txt the walker does not load), the lighter successor and the retirement with no successor at no proof and at journey let rcf build verdict review MERGE/PASS exit 0 writing review.json and light Finalise exit 0 writing complete', async (t) => {
  const cases = [
    ['quoted', quoted(true)],
    ...layouts({ decision: true }).map(([kind, , opts]) => [kind, opts]),
    ['shadow', shadow(true)],
    ['succ', succeeded(undefined, 'external', true)],
    ['orphan-full', orphaned(undefined, { decision: true })],
    ['orphan-journey', orphaned('journey', { decision: true })],
  ];
  for (const [name, opts] of cases) {
    // The C-quoted spelling: the review verb only, since light Finalise's
    // later separation audit classifies that path on its own.
    await passedBoth(await round(t, { name: `snap-ok-${name}`, ...opts }), { finalise: name !== 'quoted' });
  }
});
