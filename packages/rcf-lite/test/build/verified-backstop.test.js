// FBS-221 (US-19003): bundle --next refuses while a merged spec is complete and not verified.
//
// Every test drives `node bin/rcf.js` in a fixture project built by
// initProject (FBS-001 at buildOrder 1, AC-101-1), with further FBS made by
// `define create fbs` and the lifecycle driven by `build mark`. Every
// `bundle --next` call passes the freeze gate's own --override, so a refusal
// the tests see is never the freeze gate's (and the freeze override is shown
// not to bypass the backstop). The backstop record is planted with the three
// keys `rcf build backstop adopt` writes (AC-19003-4), except in the end to
// end test, which adopts it through the verb and clears it through the real
// `rcf build finalise` (FBS-220), the producer of `verified`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const AC = 'AC-101-1';
const BACKSTOP = join('rcf', 'define', 'backstop.json');
const FREEZE_OVERRIDE = ['--override', 'fixture: unfrozen tree'];
const REASON = 'hotfix while FBS-001 re-verifies';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: GIT_ENV, encoding: 'utf8',
  }).trim();
}

function commitAll(cwd, subject, trailers = {}) {
  git(cwd, 'add', '-A');
  const body = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`).join('\n');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', body ? `${subject}\n\n${body}` : subject);
  return git(cwd, 'rev-parse', 'HEAD');
}

async function rcf(cwd, args) {
  const env = { ...process.env, CI: '1', PATH: '/usr/bin:/bin' };
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function next(root, extra = []) {
  return rcf(root, ['build', 'bundle', '--next', ...FREEZE_OVERRIDE, ...extra]);
}

async function must(root, args) {
  const r = await rcf(root, args);
  assert.equal(r.code, 0, `fixture: rcf ${args.join(' ')}\n${r.stderr}`);
  return r;
}

// FBS-001 (buildOrder 1, from initProject) with a Code Node for AC-101-1,
// plus `extra` further FBS (FBS-002 at buildOrder 2, FBS-003 at 3), then
// each id in `complete` driven notStarted -> inProgress -> complete.
async function world({ extra = 1, complete = ['FBS-001'] } = {}) {
  const root = await scratchDir('rcf-backstop221-');
  await initProject({ projectRoot: root, projectName: 'Backstop' });
  await declareUiNoneForTests(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  await must(root, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', AC]);
  const titles = ['Second', 'Third'];
  for (let i = 0; i < extra; i += 1) {
    await must(root, ['define', 'create', 'fbs', '--parent', 'BS-001', '--title', titles[i], '--acs', AC]);
  }
  for (const id of complete) {
    await must(root, ['build', 'mark', id, 'inProgress']);
    await must(root, ['build', 'mark', id, 'complete']);
  }
  return root;
}

async function plantBackstop(root, fromBuildOrder) {
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  const record = { fromBuildOrder, adoptedAt: '2026-10-19T00:00:00.000Z', adoptedBy: 'fixture@example.com' };
  await writeFile(join(root, BACKSTOP), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function readBackstop(root) {
  return JSON.parse(await readFile(join(root, BACKSTOP), 'utf8'));
}

async function status(root, id) {
  return JSON.parse(await readFile(join(root, 'rcf', 'fbs', `${id.toLowerCase()}.json`), 'utf8')).executionStatus;
}

async function fbsHashes(root) {
  const dir = join(root, 'rcf', 'fbs');
  const out = {};
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    out[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex');
  }
  return out;
}

function backstopLine(ids) {
  return `backstop: ${ids.length} merged spec(s) complete and not verified: ${ids.join(', ')}; run rcf build finalise ${ids[0]} or pass --allow-unverified "<reason>"`;
}

function assertNoBundle(r, label) {
  assert.ok(!r.stdout.includes('# Spec bundle:'), `${label}: no bundle on stdout\nstdout:\n${r.stdout}`);
}

function isIso(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && !Number.isNaN(Date.parse(s));
}

test('AC-19003-1: rcf build bundle --next with an FBS at or above backstop fromBuildOrder at complete exits 4 with "backstop: <k> merged spec(s) complete and not verified: <ids>; run rcf build finalise <id> or pass --allow-unverified "<reason>"" and emits no bundle', async (t) => {
  await t.test('one complete FBS at fromBuildOrder (k=1): exact line', async () => {
    const root = await world();
    await plantBackstop(root, 1);
    const r = await next(root);
    assert.equal(r.code, 4, `backstop refuses exit 4\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(backstopLine(['FBS-001'])), `stderr carries the backstop line\nstderr:\n${r.stderr}`);
    assert.ok(!r.stderr.includes('refused on an unfrozen tree'), 'the refusal is the backstop, not the freeze gate');
    assertNoBundle(r, 'k=1');
  });

  await t.test('two complete FBS above fromBuildOrder (k=2): count and both ids', async () => {
    const root = await world({ extra: 2, complete: ['FBS-001', 'FBS-002'] });
    await plantBackstop(root, 1);
    const r = await next(root);
    assert.equal(r.code, 4, `backstop refuses exit 4\nstderr:\n${r.stderr}`);
    const line = r.stderr.split('\n').find((l) => l.includes('backstop: 2 merged spec(s) complete and not verified: '));
    assert.ok(line, `stderr carries "backstop: 2 merged spec(s) complete and not verified: "\nstderr:\n${r.stderr}`);
    assert.ok(line.includes('FBS-001') && line.includes('FBS-002'), `both ids named: ${line}`);
    assert.match(line, /; run rcf build finalise FBS-00[12] or pass --allow-unverified "<reason>"/);
    assertNoBundle(r, 'k=2');
  });
});

test('AC-19003-2: rcf build bundle --next --allow-unverified "<reason>" emits the bundle, appends { reason, by, at, unverifiedFbsIds } to backstop.overrides in rcf/define/backstop.json and prints "backstop overridden: <reason>" on stdout; an empty reason exits 2', async (t) => {
  await t.test('a reason emits the bundle and records the override', async () => {
    const root = await world();
    const plain = await next(root);
    assert.equal(plain.code, 0, `fixture: no backstop yet hands out FBS-002\n${plain.stderr}`);
    assert.ok(plain.stdout.includes('# Spec bundle: FBS-002'), 'fixture: FBS-002 is next');
    await plantBackstop(root, 1);
    const r = await next(root, ['--allow-unverified', REASON]);
    assert.equal(r.code, 0, `override proceeds: exit 0\nstderr:\n${r.stderr}`);
    assert.ok(r.stdout.includes(`backstop overridden: ${REASON}`), `stdout carries the override line\nstdout:\n${r.stdout.slice(0, 400)}`);
    assert.ok(r.stdout.includes(plain.stdout), 'stdout carries the same bundle the tree hands out with no backstop');
    const record = await readBackstop(root);
    assert.equal(record.fromBuildOrder, 1, 'the window is kept');
    assert.ok(Array.isArray(record.overrides), 'backstop.overrides is an array');
    assert.equal(record.overrides.length, 1, 'one override appended');
    const [o] = record.overrides;
    assert.equal(o.reason, REASON);
    assert.equal(typeof o.by, 'string');
    assert.ok(o.by.trim().length > 0, 'by is non-empty');
    assert.ok(isIso(o.at), `at is an ISO timestamp: ${o.at}`);
    assert.deepEqual(o.unverifiedFbsIds, ['FBS-001']);
  });

  await t.test('an empty reason exits 2 and leaves backstop.json byte-identical', async () => {
    const root = await world();
    await plantBackstop(root, 1);
    const before = await readFile(join(root, BACKSTOP));
    const r = await next(root, ['--allow-unverified', '']);
    assert.equal(r.code, 2, `empty reason exits 2\nstderr:\n${r.stderr}`);
    assertNoBundle(r, 'empty reason');
    assert.ok((await readFile(join(root, BACKSTOP))).equals(before), 'backstop.json unchanged');
  });
});

test('AC-19003-3: rcf build bundle --next with no rcf/define/backstop.json, or one whose complete FBS all have buildOrder below fromBuildOrder, does not refuse and the bundle behaves as before (exit 0, stdout byte-identical to the run with no backstop file)', async () => {
  const root = await world();
  const absent = await next(root);
  assert.equal(absent.code, 0, `no backstop file: exit 0\nstderr:\n${absent.stderr}`);
  assert.ok(absent.stdout.includes('# Spec bundle: FBS-002'), 'no backstop file: FBS-002 bundle');
  assert.ok(!absent.stderr.includes('backstop:'), 'no backstop file: no backstop refusal');

  // FBS-001 (buildOrder 1, complete) sits below the window starting at 2.
  await plantBackstop(root, 2);
  const below = await next(root);
  assert.equal(below.code, 0, `complete FBS below fromBuildOrder: exit 0\nstderr:\n${below.stderr}`);
  assert.equal(below.stdout, absent.stdout, 'stdout byte-identical to the run with no backstop file');
  assert.ok(!below.stderr.includes('backstop:'), 'no backstop refusal below the window');
  assert.deepEqual((await readBackstop(root)).overrides ?? [], [], 'no override recorded');

  // Control: the same tree with the window moved down to FBS-001 refuses,
  // so the pass above is the window's doing, not an inert backstop.
  await plantBackstop(root, 1);
  const inside = await next(root);
  assert.equal(inside.code, 4, `control: complete FBS inside the window refuses exit 4\nstderr:\n${inside.stderr}`);
  assert.ok(inside.stderr.includes(backstopLine(['FBS-001'])), inside.stderr);
});

test('AC-19003-4: rcf build backstop adopt --from FBS-218 exits 0 writing rcf/define/backstop.json { fromBuildOrder: 218, adoptedAt, adoptedBy }; an unknown FBS id exits 3 and a missing --from exits 2', async (t) => {
  const root = await world();
  await must(root, ['define', 'create', 'fbs', '--parent', 'BS-001', '--id', 'FBS-218', '--build-order', '218', '--title', 'Window start', '--acs', AC]);

  await t.test('unknown FBS id exits 3', async () => {
    const r = await rcf(root, ['build', 'backstop', 'adopt', '--from', 'FBS-999']);
    assert.equal(r.code, 3, `unknown id exits 3\nstderr:\n${r.stderr}`);
  });

  await t.test('missing --from exits 2', async () => {
    const r = await rcf(root, ['build', 'backstop', 'adopt']);
    assert.equal(r.code, 2, `missing --from exits 2\nstderr:\n${r.stderr}`);
  });

  await t.test('--from FBS-218 writes the record and exits 0', async () => {
    await rm(join(root, BACKSTOP), { force: true });
    const r = await rcf(root, ['build', 'backstop', 'adopt', '--from', 'FBS-218']);
    assert.equal(r.code, 0, `adopt exits 0\nstderr:\n${r.stderr}`);
    const record = await readBackstop(root);
    assert.equal(record.fromBuildOrder, 218);
    assert.ok(isIso(record.adoptedAt), `adoptedAt is an ISO timestamp: ${record.adoptedAt}`);
    assert.equal(typeof record.adoptedBy, 'string');
    assert.ok(record.adoptedBy.trim().length > 0, 'adoptedBy is non-empty');
  });
});

test('AC-19003-5: rcf build bundle --next never emits a bundle while the backstop refuses unless --allow-unverified carries a non-empty reason, and the override never changes any FBS executionStatus', async () => {
  const root = await world();
  await plantBackstop(root, 1);
  const before = await fbsHashes(root);

  const refused = await next(root);
  assert.equal(refused.code, 4, `the freeze --override alone does not pass the backstop: exit 4\nstderr:\n${refused.stderr}`);
  assert.ok(refused.stderr.includes(backstopLine(['FBS-001'])), refused.stderr);
  assertNoBundle(refused, 'no --allow-unverified');

  const empty = await next(root, ['--allow-unverified', '']);
  assert.equal(empty.code, 2, `empty reason exits 2\nstderr:\n${empty.stderr}`);
  assertNoBundle(empty, 'empty reason');

  const overridden = await next(root, ['--allow-unverified', REASON]);
  assert.equal(overridden.code, 0, `a non-empty reason proceeds\nstderr:\n${overridden.stderr}`);
  assert.ok(overridden.stdout.includes('# Spec bundle: FBS-002'), 'the override hands out FBS-002');
  assert.deepEqual(await fbsHashes(root), before, 'every rcf/fbs/*.json byte-identical after the override');
  assert.equal(await status(root, 'FBS-001'), 'complete', 'FBS-001 stays complete');

  // The override is per call, not a standing switch.
  const again = await next(root);
  assert.equal(again.code, 4, `the next plain call refuses again: exit 4\nstderr:\n${again.stderr}`);
  assert.ok(again.stderr.includes(backstopLine(['FBS-001'])), again.stderr);
  assertNoBundle(again, 'after an override');
  assert.deepEqual(await fbsHashes(root), before, 'every rcf/fbs/*.json byte-identical at the end');
});

// End to end over the producer's real output: FBS-220's administrative
// Finalise writes `verified`, and only that clears the backstop.
const CI_REF = 'gh-run-221';
const BUILDER_ID = 'build-hand-7';
const VERIFIER_ID = 'verify-hand-3';

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function verifyReport(headSha) {
  return {
    reportVersion: 1,
    fbsId: 'FBS-001',
    headSha,
    target: { kind: 'url', url: 'https://preview.example.com' },
    mode: 'deterministic',
    hand: 'verifier',
    verifierId: VERIFIER_ID,
    startedAt: isoAgo(2 * 60 * 60 * 1000),
    finishedAt: isoAgo(60 * 60 * 1000),
    rcfLiteVersion: '0.35.0',
    profile: 'deployed',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    runStats: { counts: { verified: 1, failed: 0, skipped: 0, total: 1 } },
    perAc: [{ acId: AC, result: 'pass', probe: { path: '/health', expectStatus: 200 }, evidence: { status: 200 } }],
  };
}

test('AC-19003-1 (end to end): with the backstop adopted from FBS-001, bundle --next refuses while FBS-001 is complete, the real rcf build finalise FBS-001 --ci-run <ref> writes verified, and bundle --next then hands out FBS-002 with no override recorded', async () => {
  const root = await world({ extra: 1, complete: [] });
  await must(root, ['build', 'mark', 'FBS-001', 'inProgress']);
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root, 'chore: base');
  git(root, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(root, 'src', 'save.js'), 'export function save() { return true; }\n', 'utf8');
  const headSha = commitAll(root, 'feat: save returns true', { Hand: 'builder', 'Hand-Id': BUILDER_ID });
  const reportRel = `rcf/verify-reports/FBS-001/${headSha.slice(0, 12)}.json`;
  await mkdir(dirname(join(root, reportRel)), { recursive: true });
  await writeFile(join(root, reportRel), `${JSON.stringify(verifyReport(headSha), null, 2)}\n`, 'utf8');
  commitAll(root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  await must(root, ['build', 'mark', 'FBS-001', 'complete']);
  commitAll(root, 'chain: mark FBS-001 complete');
  const adopt = await rcf(root, ['build', 'backstop', 'adopt', '--from', 'FBS-001']);
  assert.equal(adopt.code, 0, `rcf build backstop adopt --from FBS-001 exits 0\nstderr:\n${adopt.stderr}`);
  commitAll(root, 'chain: adopt the verified backstop');
  assert.equal(await status(root, 'FBS-002'), 'notStarted', 'fixture: FBS-002 waits');

  const refused = await next(root);
  assert.equal(refused.code, 4, `complete and unverified FBS-001 refuses exit 4\nstderr:\n${refused.stderr}`);
  assert.ok(refused.stderr.includes(backstopLine(['FBS-001'])), refused.stderr);
  assertNoBundle(refused, 'before finalise');

  const fin = await rcf(root, ['build', 'finalise', 'FBS-001', '--ci-run', CI_REF]);
  assert.equal(fin.code, 0, `finalise ingests the report: exit 0\nstderr:\n${fin.stderr}`);
  assert.equal(await status(root, 'FBS-001'), 'verified', 'finalise wrote verified');

  const cleared = await next(root);
  assert.equal(cleared.code, 0, `verified FBS-001 clears the backstop: exit 0\nstderr:\n${cleared.stderr}`);
  assert.ok(cleared.stdout.includes('# Spec bundle: FBS-002'), 'FBS-002 bundle emitted');
  assert.ok(!cleared.stderr.includes('backstop:'), 'no backstop refusal');
  assert.deepEqual((await readBackstop(root)).overrides ?? [], [], 'no override recorded');
});
