// FBS-243 (US-19905): the coverage-golden clause of AC-19905-16, keyed to
// round G's move of the rcf-schemas pin to 0.11.0 (the stage-keeper's
// ruling 26). AC-19905-16 succeeds AC-19501-5 (ruling 21) and keeps its
// clause "audit coverage --strict exits with the same code and gap list at
// HEAD as the coverage golden recorded at the round base before the pin
// move". The AC-19501-5 case in test/define/verification-field.test.js
// (PIN_TARGET '0.10.0') stays bound to the retired criterion as a
// historical guard; this file is its 0.11.0 sibling.
//
// The golden: round G's DEFINE records audit coverage --strict at the
// round's base 892bc858e169ec2e345123cc423cd24ad332fed8 (rcf-lite 0.40.1,
// the pin at 0.10.0), before BUILD moves the pin, as
// test/fixtures/pin-move/coverage-at-round-g-base.json, written from
// packages/rcf-lite of a temporary worktree at that commit with
//   node test/_harness/goldens.js coverage test/fixtures/pin-move/coverage-at-round-g-base.json
// It is a test-author fixture, never a declared generator's output, and is
// never re-recorded.
//
// "At HEAD" is read at the pin-move commit: the first-parent commit that
// moves the @stravica-ai/rcf-schemas dependency in
// packages/rcf-lite/package.json to PIN_TARGET, run with that tree's own bin
// over that tree's own chain in a temporary worktree with its own
// dependencies installed (the AC-19501-5 form), never the moving head, so
// no later DEFINE or BUILD moves it. Until the builder's pin move (ruling
// 16) no such commit exists and the case is red. A shallow clone fails,
// never skips.
//
// The gap list at the move is the golden's plus exactly the criteria round
// G's DEFINE retired (ruling 17: AC-19502-3 to AC-19502-5; ruling 21:
// AC-19501-5): a retired criterion's case is rebound to its successor, so
// audit coverage --json reports it uncovered, while --strict still exits 0.
// The test asserts each of them carries supersededBy in the chain at the
// move, so the difference is the retirements and nothing else.
//
// Imports: Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { run } from '../_harness/spawn.js';
import { checkoutPackage, checkoutRoot, scratch } from '../_harness/fixture.js';
import { git, gitTry } from '../_harness/git.js';
import { coverageResult } from '../_harness/goldens.js';

const PKG_JSON = 'packages/rcf-lite/package.json';
const PIN = '@stravica-ai/rcf-schemas';
// The release round G moves the pin to (the stage-keeper's ruling 16).
const PIN_TARGET = '0.11.0';
const ROUND_BASE = '892bc858e169ec2e345123cc423cd24ad332fed8';
const GOLDEN = 'test/fixtures/pin-move/coverage-at-round-g-base.json';
// Retired by round G's DEFINE (the stage-keeper's rulings 17 and 21).
const RETIRED_IN_ROUND = ['AC-19501-5', 'AC-19502-3', 'AC-19502-4', 'AC-19502-5'];

function pinAt(root, rev) {
  const r = gitTry(root, 'show', `${rev}:${PKG_JSON}`);
  return r.code === 0 ? (JSON.parse(r.stdout).dependencies?.[PIN] ?? null) : null;
}
function pinMoveCommit(root) {
  assert.equal(git(root, 'rev-parse', '--is-shallow-repository'), 'false', 'shallow clone: the history of the pin move is not there');
  const candidates = git(root, 'log', '--first-parent', '--format=%H', 'HEAD', '--', PKG_JSON).split('\n').filter(Boolean);
  const move = candidates.find((c) => pinAt(root, c) === PIN_TARGET && pinAt(root, `${c}^1`) !== PIN_TARGET);
  assert.ok(move, `a first-parent commit moves the ${PIN} dependency in ${PKG_JSON} to ${PIN_TARGET}`);
  return move;
}
function worktreeAt(t, root, rev) {
  const dir = join(scratch(t, 'rcf-h-pinwt-'), 'wt');
  git(root, 'worktree', 'add', '--detach', '--quiet', dir, rev);
  t.after(() => { gitTry(root, 'worktree', 'remove', '--force', dir); gitTry(root, 'worktree', 'prune'); });
  const inst = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], { cwd: dir, env: { PATH: process.env.PATH } });
  assert.equal(inst.code, 0, `pnpm install in the worktree at ${rev}\n${inst.stdout.slice(-1000)}${inst.stderr.slice(-1000)}`);
  return join(dir, 'packages', 'rcf-lite');
}
function supersededAt(root, rev, acId) {
  const usId = `US-${acId.split('-')[1]}`;
  const r = gitTry(root, 'show', `${rev}:packages/rcf-lite/rcf/user-stories/${usId.toLowerCase()}.json`);
  if (r.code !== 0) return null;
  return JSON.parse(r.stdout).acceptanceCriteria.find((a) => a.id === acId)?.supersededBy ?? null;
}

test('AC-19905-16: at the commit that moves the rcf-schemas pin to 0.11.0, audit coverage --strict over the own chain exits with the same code and gap list as the coverage golden recorded at the round G base before the pin move, the gap list differing only by the criteria round G retired', async (t) => {
  const pkg = checkoutPackage();
  const golden = join(pkg, GOLDEN);
  assert.ok(existsSync(golden), `round G's DEFINE records the coverage golden at the round base ${ROUND_BASE}: ${GOLDEN} is absent`);
  const was = JSON.parse(readFileSync(golden, 'utf8'));
  assert.ok(Number.isInteger(was.exitCode) && Array.isArray(was.gaps), `${GOLDEN} holds { "exitCode", "gaps" }`);
  const root = checkoutRoot();
  const move = pinMoveCommit(root);
  for (const id of RETIRED_IN_ROUND) {
    assert.equal(supersededAt(root, ROUND_BASE, id), null, `${id} is live at the round base`);
    assert.ok(supersededAt(root, move, id), `${id} carries supersededBy at the pin move ${move}`);
  }
  const at = worktreeAt(t, root, move);
  const installed = JSON.parse(readFileSync(join(at, 'node_modules', '@stravica-ai', 'rcf-schemas', 'package.json'), 'utf8')).version;
  assert.equal(installed, PIN_TARGET, `the copy bin/rcf.js resolves at the pin move is ${PIN_TARGET}`);
  const now = await coverageResult(at, { bin: join(at, 'bin', 'rcf.js') });
  assert.equal(now.exitCode, was.exitCode, `audit coverage --strict exits ${now.exitCode} at the pin move and ${was.exitCode} in the golden recorded before it`);
  assert.deepEqual(now.gaps, [...was.gaps, ...RETIRED_IN_ROUND].sort(), 'the gap list of the golden recorded before the pin move, plus only the criteria round G retired');
});
