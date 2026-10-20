// FBS-223 (US-19102): the mixed escape, the class override file, --require-hand and CI on pull requests.
//
// One test per AC of US-19102, bound by TS-256. Each builds a fixture git
// history in a scratch dir (test/_helpers/git-history.js for the world,
// test/_helpers/git-trailers.js for commits carrying Hand:,
// Separation-Reason: and Hand-Id: as a real trailer block), reads every
// commit back through git before it runs rcf, then drives bin/rcf.js from
// the fixture root. With no --base the range is the merge-base with
// origin/main to HEAD; <sha7> is the first seven characters of a sha; the
// verdict line and --json go to stdout, refusals to stderr. AC-19102-4 and
// the workflow half of AC-19102-5 read this repository's own
// .github/workflows/ci.yml (located by findRepoRoot below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { baseAndHead, git, gitWorld, mergeBranch, runRcf } from '../_helpers/git-history.js';
import { commitTrailers, readTrailers, shallowClone } from '../_helpers/git-trailers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RCF_BIN = resolve(HERE, '..', '..', 'bin', 'rcf.js');
const s7 = (sha) => sha.slice(0, 7);
const lines = (text) => text.split('\n').filter(Boolean);

const REASON = 'rename crosses test and src';
const NO_REASON = 'mixed without Separation-Reason';

// The fixture is what the criterion presumes: one entry per commit in
// range, oldest first, with exactly these parsed trailers and paths (and,
// where given, this raw trailer paragraph as typed).
function assertFixture(world, expected, opts) {
  const got = readTrailers(world, opts);
  assert.equal(got.length, expected.length, 'fixture has a different number of commits in range');
  expected.forEach((e, i) => {
    const g = got[i];
    assert.equal(g.parents.length > 1, Boolean(e.merge), `commit ${i + 1}: merge shape`);
    assert.deepEqual(g.trailers, e.trailers, `commit ${i + 1}: trailers as git parses them`);
    if (!e.merge) assert.deepEqual(g.paths, [...e.paths].sort(), `commit ${i + 1}: paths`);
    if (e.raw !== undefined) assert.equal(g.lastParagraph, e.raw, `commit ${i + 1}: raw trailer block`);
  });
  return got;
}

function run(world, args, opts) {
  return runRcf(world, RCF_BIN, ['audit', 'separation', ...args], opts);
}

// The exit the criterion names, and never a refusal it does not name.
function expectExit(res, code) {
  assert.equal(res.code, code, `exit ${res.code}; stdout: ${res.stdout}; stderr: ${res.stderr}`);
  assert.doesNotMatch(res.stderr, /\[error\] usage/, 'refused as a usage error');
  assert.doesNotMatch(res.stderr, /unknown verb/, 'refused as an unknown verb');
}

function rowsOf(res) {
  return JSON.parse(res.stdout);
}

const passLine = (world, counts) => {
  const { base, head } = baseAndHead(world);
  const c = { 'test-author': 0, builder: 0, verifier: 0, 'stage-keeper': 0, neutral: 0, undeclared: 0, exceptions: 0, ...counts };
  const n = Object.entries(c).filter(([k]) => k !== 'exceptions').reduce((a, [, v]) => a + v, 0) + c.exceptions;
  return `separation: PASS ${n} commits (base ${s7(base)}, head ${s7(head)}): ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')}`;
};

// The FAIL line's item for one commit (items are `; `-separated after the range).
function failItem(res, sha) {
  const [line] = lines(res.stdout);
  assert.match(line ?? '', /^separation: FAIL /, `no FAIL line; stdout: ${res.stdout}`);
  const items = line.slice(line.indexOf('): ') + 3).split('; ');
  const item = items.find((it) => it.startsWith(`${s7(sha)} `));
  assert.ok(item, `FAIL line does not name ${s7(sha)}: ${line}`);
  return { line, item, items };
}

test('AC-19102-1: rcf audit separation passes a Hand: mixed commit with Separation-Reason as an exception (exceptions 1, --json verdict "exception"); Hand: mixed without a reason exits 4 with "mixed without Separation-Reason"', async (t) => {
  await t.test('Hand: mixed with Separation-Reason touching src/ and test/ passes as an exception', async (t) => {
    const world = await gitWorld(t);
    const ta = commitTrailers(world, 'test first', ['test/y.test.js'], [['Hand', 'test-author']]);
    const mixed = commitTrailers(world, 'rename', ['src/x.js', 'test/x.test.js'],
      [['Hand', 'mixed'], ['Separation-Reason', REASON]]);
    assertFixture(world, [
      { trailers: ['Hand: test-author'], paths: ['test/y.test.js'] },
      { trailers: ['Hand: mixed', `Separation-Reason: ${REASON}`], paths: ['src/x.js', 'test/x.test.js'] },
    ]);

    const res = run(world, []);
    expectExit(res, 0);
    assert.deepEqual(lines(res.stdout), [passLine(world, { 'test-author': 1, exceptions: 1 })]);

    const js = run(world, ['--json']);
    expectExit(js, 0);
    const rows = rowsOf(js);
    assert.deepEqual(rows.map((r) => [r.sha, r.verdict]), [[ta, 'pass'], [mixed, 'exception']]);
    assert.equal(rows[1].hand, 'mixed');
    assert.equal(rows[1].reason, REASON, 'the exception row carries the Separation-Reason text');
  });

  for (const [label, trailers, parsed] of [
    ['absent', [['Hand', 'mixed']], ['Hand: mixed']],
    ['empty', [['Hand', 'mixed'], ['Separation-Reason', '']], ['Hand: mixed', 'Separation-Reason:']],
  ]) {
    await t.test(`Hand: mixed with an ${label} Separation-Reason touching src/ and test/ fails exit 4 with "${NO_REASON}"`, async (t) => {
      const world = await gitWorld(t);
      const mixed = commitTrailers(world, `mixed ${label}`, ['src/x.js', 'test/x.test.js'], trailers);
      assertFixture(world, [{ trailers: parsed, paths: ['src/x.js', 'test/x.test.js'] }]);

      const res = run(world, []);
      expectExit(res, 4);
      assert.match(failItem(res, mixed).line, /^separation: FAIL 1 of 1 commits /);

      const js = run(world, ['--json']);
      expectExit(js, 4);
      const [row] = rowsOf(js);
      assert.equal(row.sha, mixed);
      assert.equal(row.verdict, 'fail');
      assert.equal(row.reason, NO_REASON);
    });
  }
});

const OVERRIDE = `${JSON.stringify({ classes: { test: ['spec/**'] } }, null, 2)}\n`;

test('AC-19102-2: rcf audit separation with rcf/separation.json { classes: { test: ["spec/**"] } } exits 4 naming spec/a.js for a builder commit; a malformed rcf/separation.json exits 2 naming the file; a builder edit to it fails as a criteria-class touch', async (t) => {
  await t.test('a Hand: builder commit touching spec/a.js under the override exits 4 naming spec/a.js', async (t) => {
    const world = await gitWorld(t, { baseFiles: { 'README.md': '# fixture\n', 'rcf/separation.json': OVERRIDE } });
    const b = commitTrailers(world, 'spec edit', ['spec/a.js'], [['Hand', 'builder']]);
    assertFixture(world, [{ trailers: ['Hand: builder'], paths: ['spec/a.js'] }]);
    assert.equal(git(world, world.repo, ['show', 'HEAD:rcf/separation.json']), OVERRIDE.trim());

    const res = run(world, []);
    expectExit(res, 4);
    const { base, head } = baseAndHead(world);
    assert.deepEqual(lines(res.stdout),
      [`separation: FAIL 1 of 1 commits (base ${s7(base)}, head ${s7(head)}): ${s7(b)} Hand=builder touches spec/a.js`]);
  });

  await t.test('a malformed rcf/separation.json exits 2 naming the file', async (t) => {
    const world = await gitWorld(t, { baseFiles: { 'README.md': '# fixture\n', 'rcf/separation.json': '{ "classes": \n' } });
    commitTrailers(world, 'production', ['src/x.js'], [['Hand', 'builder'], ['Hand-Id', 'fixture-session']]);
    assertFixture(world, [{ trailers: ['Hand: builder', 'Hand-Id: fixture-session'], paths: ['src/x.js'] }]);

    const res = run(world, []);
    expectExit(res, 2);
    assert.match(res.stderr, /rcf\/separation\.json/, 'the refusal names the file');
    assert.doesNotMatch(res.stdout, /separation: (PASS|FAIL)/, 'no verdict line on a malformed override');
  });

  // Guard, green at Define: today rcf/separation.json classes criteria.
  // The edit tries to reclassify the file itself as production.
  await t.test('guard: a Hand: builder commit editing rcf/separation.json fails as a criteria-class touch', async (t) => {
    const world = await gitWorld(t, { baseFiles: { 'README.md': '# fixture\n', 'rcf/separation.json': OVERRIDE } });
    const hijack = `${JSON.stringify({ classes: { production: ['rcf/separation.json', 'spec/**'] } }, null, 2)}\n`;
    const b = commitTrailers(world, 'override edit', ['rcf/separation.json'], [['Hand', 'builder']],
      { files: { 'rcf/separation.json': hijack } });
    assertFixture(world, [{ trailers: ['Hand: builder'], paths: ['rcf/separation.json'] }]);

    const res = run(world, []);
    expectExit(res, 4);
    const { base, head } = baseAndHead(world);
    assert.deepEqual(lines(res.stdout),
      [`separation: FAIL 1 of 1 commits (base ${s7(base)}, head ${s7(head)}): ${s7(b)} Hand=builder touches rcf/separation.json`]);
    const js = run(world, ['--json']);
    expectExit(js, 4);
    const [row] = rowsOf(js);
    assert.equal(row.verdict, 'fail');
    assert.equal(row.reason, 'builder touches criteria');
  });
});

test('AC-19102-3: rcf audit separation --require-hand exits 4 naming the commit and the missing trailer for a commit with no Hand: trailer or a Hand: builder commit with no Hand-Id: trailer', async (t) => {
  await t.test('--require-hand: a non-merge commit with no Hand: trailer exits 4 naming it and Hand:', async (t) => {
    const world = await gitWorld(t);
    commitTrailers(world, 'tests', ['test/x.test.js'], [['Hand', 'test-author']]);
    const bare = commitTrailers(world, 'undeclared', ['test/y.test.js'], []);
    assertFixture(world, [
      { trailers: ['Hand: test-author'], paths: ['test/x.test.js'] },
      { trailers: [], paths: ['test/y.test.js'], raw: '' },
    ]);

    const res = run(world, ['--require-hand']);
    expectExit(res, 4);
    const { line, item } = failItem(res, bare);
    assert.match(line, /^separation: FAIL 1 of 2 commits /);
    assert.match(item, /(^|[^-\w])Hand:/, `the item names the missing Hand: trailer: ${item}`);
  });

  await t.test('--require-hand: a Hand: builder commit with no Hand-Id: trailer exits 4 naming it and Hand-Id:', async (t) => {
    const world = await gitWorld(t);
    commitTrailers(world, 'tests', ['test/x.test.js'], [['Hand', 'test-author']]);
    const b = commitTrailers(world, 'production', ['src/x.js'], [['Hand', 'builder']]);
    assertFixture(world, [
      { trailers: ['Hand: test-author'], paths: ['test/x.test.js'] },
      { trailers: ['Hand: builder'], paths: ['src/x.js'] },
    ]);

    const res = run(world, ['--require-hand']);
    expectExit(res, 4);
    const { line, item } = failItem(res, b);
    assert.match(line, /^separation: FAIL 1 of 2 commits /);
    assert.match(item, /Hand-Id:/, `the item names the missing Hand-Id: trailer: ${item}`);
  });

  await t.test('control: --require-hand with every non-merge commit declared and the builder commit carrying Hand-Id: exits 0', async (t) => {
    const world = await gitWorld(t);
    commitTrailers(world, 'tests', ['test/x.test.js'], [['Hand', 'test-author']]);
    git(world, world.repo, ['checkout', '-q', '-b', 'side']);
    commitTrailers(world, 'production', ['src/x.js'], [['Hand', 'builder'], ['Hand-Id', 'fixture-session-1']]);
    git(world, world.repo, ['checkout', '-q', 'feature']);
    mergeBranch(world, 'side', 'merge side');
    assertFixture(world, [
      { trailers: ['Hand: test-author'], paths: ['test/x.test.js'] },
      { trailers: ['Hand: builder', 'Hand-Id: fixture-session-1'], paths: ['src/x.js'] },
      { trailers: [], merge: true },
    ]);

    const res = run(world, ['--require-hand']);
    expectExit(res, 0);
    assert.deepEqual(lines(res.stdout), [passLine(world, { 'test-author': 1, builder: 1 })]);
  });
});

// The repository root holding this package: walk up from this file (the
// clone) and from the shell's working directory the run inherited (PWD,
// or INIT_CWD under a package manager: inside `rcf verify run --artefact`
// this file runs from a scratch copy, and the verifier's shell sits in the
// clone). The root is the first directory holding both
// .github/workflows/ci.yml and packages/rcf-lite/package.json.
function findRepoRoot() {
  const starts = [HERE, process.env.PWD, process.env.INIT_CWD].filter(Boolean);
  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      if (existsSync(join(dir, '.github', 'workflows', 'ci.yml')) && existsSync(join(dir, 'packages', 'rcf-lite', 'package.json'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  assert.fail(`no repository root with .github/workflows/ci.yml above ${starts.join(', ')}`);
}

// ci.yml parsed with the repository's own js-yaml (a devDependency of
// packages/rcf-lite, resolved from the root found above, so it loads in
// the clone and beside the installed artefact alike).
function loadWorkflow() {
  const root = findRepoRoot();
  const yaml = createRequire(join(root, 'packages', 'rcf-lite', 'package.json'))('js-yaml');
  return yaml.load(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
}

const SEPARATION_RUN = 'node bin/rcf.js audit separation --base origin/${{ github.base_ref }}';
const PR_ONLY = /^(\$\{\{\s*)?github\.event_name\s*==\s*['"]pull_request['"](\s*\}\})?$/;

// The job whose step runs the separation command, and that step.
function separationJob(wf) {
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const at = steps.findIndex((s) => typeof s.run === 'string' && s.run.trim() === SEPARATION_RUN);
    if (at !== -1) return { id, job, steps, at, step: steps[at] };
  }
  return assert.fail(`no job in ci.yml has a step whose run is exactly "${SEPARATION_RUN}"`);
}

function separationCheckout({ steps, at }) {
  const checkout = steps.slice(0, at).filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  assert.equal(checkout.length, 1, 'one actions/checkout step before the separation step in its job');
  return checkout[0];
}

test('AC-19102-4: on pull_request, CI runs node bin/rcf.js audit separation --base origin/${{ github.base_ref }} from packages/rcf-lite after checkout fetch-depth 0 and its exit code fails the job; the step does not run on push to main', () => {
  const wf = loadWorkflow();
  const on = wf.on ?? wf[true];
  assert.ok(on && typeof on === 'object' && 'pull_request' in on, 'ci.yml triggers on pull_request');

  const found = separationJob(wf);
  assert.equal(found.step['working-directory'], 'packages/rcf-lite');
  assert.ok(!/\|\|/.test(found.step.run), 'nothing swallows the exit code');
  assert.notEqual(found.job['continue-on-error'], true, 'the job does not continue on error');
  assert.notEqual(found.step['continue-on-error'], true, 'the step does not continue on error');

  const checkout = separationCheckout(found);
  assert.equal(Number(checkout.with?.['fetch-depth']), 0, 'checkout fetch-depth 0');
  assert.notEqual(checkout.with?.['fetch-depth'], undefined, 'fetch-depth is set');

  // Not on push to main: either the workflow has no push trigger, or the
  // job or the step is gated to the pull_request event.
  const gated = [found.job.if, found.step.if].some((cond) => typeof cond === 'string' && PR_ONLY.test(cond.trim()));
  assert.ok(!('push' in on) || gated, 'the separation step is gated to pull_request (job or step if: github.event_name == \'pull_request\')');
});

test('AC-19102-5: an empty or whitespace Separation-Reason never turns Hand: mixed into a pass, and rcf audit separation on a shallow checkout exits 2 naming the missing base', async (t) => {
  for (const [label, value, raw] of [
    ['empty', '', 'Hand: mixed\nSeparation-Reason:'],
    ['whitespace-only', '   ', 'Hand: mixed\nSeparation-Reason:    '],
  ]) {
    await t.test(`an ${label} Separation-Reason on a Hand: mixed commit touching one class fails exit 4 with "${NO_REASON}"`, async (t) => {
      const world = await gitWorld(t);
      const mixed = commitTrailers(world, `mixed ${label}`, ['test/x.test.js'], [['Hand', 'mixed'], ['Separation-Reason', value]]);
      assertFixture(world, [{ trailers: ['Hand: mixed', 'Separation-Reason:'], paths: ['test/x.test.js'], raw }]);

      const res = run(world, []);
      expectExit(res, 4);
      assert.match(failItem(res, mixed).line, /^separation: FAIL 1 of 1 commits /);
      const js = run(world, ['--json']);
      expectExit(js, 4);
      const [row] = rowsOf(js);
      assert.equal(row.verdict, 'fail');
      assert.equal(row.reason, NO_REASON);
    });

    await t.test(`an ${label} Separation-Reason on a Hand: mixed commit touching src/ and test/ never passes as an exception`, async (t) => {
      const world = await gitWorld(t);
      commitTrailers(world, `mixed ${label}`, ['src/x.js', 'test/x.test.js'], [['Hand', 'mixed'], ['Separation-Reason', value]]);
      assertFixture(world, [{ trailers: ['Hand: mixed', 'Separation-Reason:'], paths: ['src/x.js', 'test/x.test.js'], raw }]);

      const js = run(world, ['--json']);
      expectExit(js, 4);
      const [row] = rowsOf(js);
      assert.equal(row.verdict, 'fail');
      assert.equal(row.reason, NO_REASON);
    });
  }

  await t.test('the CI separation step checks out with fetch-depth 0', () => {
    const checkout = separationCheckout(separationJob(loadWorkflow()));
    assert.equal(checkout.with?.['fetch-depth'] !== undefined && Number(checkout.with['fetch-depth']), 0);
  });

  // The shallow world: a builder commit that violates separation, then two
  // clean test-author commits, pushed to the local origin and cloned at
  // depth 1, so origin/main resolves but the history between it and the
  // head is cut at the head.
  async function shallowWorld(t) {
    const world = await gitWorld(t);
    commitTrailers(world, 'violation', ['test/hidden.test.js'], [['Hand', 'builder']]);
    commitTrailers(world, 'tests 1', ['test/a.test.js'], [['Hand', 'test-author']]);
    commitTrailers(world, 'tests 2', ['test/b.test.js'], [['Hand', 'test-author']]);
    git(world, world.repo, ['push', '-q', 'origin', 'feature']);
    const clone = shallowClone(world, { depth: 1 });
    assert.equal(git(world, clone, ['rev-parse', '--is-shallow-repository']), 'true', 'the clone is shallow');
    assert.equal(git(world, clone, ['rev-parse', 'HEAD']), git(world, world.repo, ['rev-parse', 'HEAD']));
    assert.equal(git(world, clone, ['rev-parse', 'origin/main']), git(world, world.repo, ['rev-parse', 'origin/main']));
    const seen = readTrailers(world, { cwd: clone, range: 'origin/main..HEAD' });
    assert.deepEqual(seen.map((c) => c.trailers), [['Hand: test-author']], 'depth 1 sees only the head commit');
    return { world, clone };
  }

  await t.test('on a depth-1 clone, the CI command (--base origin/main) exits 2 naming the missing base', async (t) => {
    const { world, clone } = await shallowWorld(t);
    const res = run(world, ['--base', 'origin/main'], { cwd: clone });
    expectExit(res, 2);
    assert.match(res.stderr, /origin\/main/, 'the refusal names the missing base');
    assert.doesNotMatch(res.stdout, /separation: (PASS|FAIL)/, 'a shallow range never yields a verdict');
  });

  // Guard, green at Define: with no --base the merge-base is missing and
  // FBS-222 refuses "separation: bad ref origin/main" (exit 2).
  await t.test('guard: on a depth-1 clone with no --base the verb exits 2 naming the missing base', async (t) => {
    const { world, clone } = await shallowWorld(t);
    const res = run(world, [], { cwd: clone });
    expectExit(res, 2);
    assert.match(res.stderr, /origin\/main/, 'the refusal names the missing base');
    assert.doesNotMatch(res.stdout, /separation: (PASS|FAIL)/, 'a shallow range never yields a verdict');
  });
});

// Gate 1 finding BH-1 (FBS-223 fix round): under --require-hand a commit that
// also breaks path ownership must still name its missing trailer. Each case
// pairs the failing commit with one passing declared commit, reads the
// failing commit's FAIL-line item and its --json row, and holds the item to
// one `; `-free entry so one commit reads as one item. Whether the item and
// the reason also name the ownership breach, and in which order, is left to
// the build; without --require-hand the same shapes are FBS-222's (TS-255).
test('AC-19102-3: rcf audit separation --require-hand exits 4 naming the missing Hand: trailer for a commit with no Hand: trailer that also touches test and production', async (t) => {
  const world = await gitWorld(t);
  commitTrailers(world, 'tests', ['test/y.test.js'], [['Hand', 'test-author']]);
  const bare = commitTrailers(world, 'undeclared two classes', ['src/x.js', 'test/x.test.js'], []);
  assertFixture(world, [
    { trailers: ['Hand: test-author'], paths: ['test/y.test.js'] },
    { trailers: [], paths: ['src/x.js', 'test/x.test.js'], raw: '' },
  ]);

  const res = run(world, ['--require-hand']);
  expectExit(res, 4);
  const { line, item, items } = failItem(res, bare);
  assert.match(line, /^separation: FAIL 1 of 2 commits /);
  assert.equal(items.length, 1, `one failed commit reads as one item: ${line}`);
  assert.match(item, /(^|[^-\w])Hand:/, `the item names the missing Hand: trailer: ${item}`);

  const json = run(world, ['--require-hand', '--json']);
  expectExit(json, 4);
  const rows = rowsOf(json);
  const row = rows.find((r) => r.sha === bare);
  assert.ok(row, `--json has a row for ${s7(bare)}`);
  assert.equal(row.verdict, 'fail');
  assert.match(row.reason ?? '', /(^|[^-\w])Hand:/, `the reason names the missing Hand: trailer: ${row.reason}`);
  assert.deepEqual(rows.filter((r) => r.sha !== bare).map((r) => r.verdict), ['pass'], 'the declared commit passes');
});

test('AC-19102-3: rcf audit separation --require-hand exits 4 naming the missing Hand-Id: trailer for a Hand: builder commit with no Hand-Id: trailer that also touches a test path', async (t) => {
  const world = await gitWorld(t);
  commitTrailers(world, 'tests', ['test/y.test.js'], [['Hand', 'test-author']]);
  const b = commitTrailers(world, 'production and a test', ['src/x.js', 'test/x.test.js'], [['Hand', 'builder']]);
  assertFixture(world, [
    { trailers: ['Hand: test-author'], paths: ['test/y.test.js'] },
    { trailers: ['Hand: builder'], paths: ['src/x.js', 'test/x.test.js'] },
  ]);

  const res = run(world, ['--require-hand']);
  expectExit(res, 4);
  const { line, item, items } = failItem(res, b);
  assert.match(line, /^separation: FAIL 1 of 2 commits /);
  assert.equal(items.length, 1, `one failed commit reads as one item: ${line}`);
  assert.match(item, /Hand-Id:/, `the item names the missing Hand-Id: trailer: ${item}`);

  const json = run(world, ['--require-hand', '--json']);
  expectExit(json, 4);
  const rows = rowsOf(json);
  const row = rows.find((r) => r.sha === b);
  assert.ok(row, `--json has a row for ${s7(b)}`);
  assert.equal(row.verdict, 'fail');
  assert.match(row.reason ?? '', /Hand-Id:/, `the reason names the missing Hand-Id: trailer: ${row.reason}`);
  assert.deepEqual(rows.filter((r) => r.sha !== b).map((r) => r.verdict), ['pass'], 'the declared commit passes');
});
