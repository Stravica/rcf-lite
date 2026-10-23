// FBS-231 (US-16103, AC-16103-4): a feedback entry recorded in a linked git
// worktree survives the worktree's removal and is offered from the main
// checkout. Where the queue lives is the builder's choice; this test asserts
// only what the operator sees through `rcf feedback list`.
//
// The fixture is a real git repository (host config isolated) holding an rcf
// project whose .gitignore covers .rcf/feedback/. The test adds a worktree with
// `git worktree add`, records an entry there with `node bin/rcf.js feedback
// add`, removes the worktree with `git worktree remove` (no --force), and
// lists the queue from the main checkout. No network: `rcf feedback list` only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const ISOLATED = {
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: { ...process.env, ...ISOLATED }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function rcf(cwd, args) {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: '/usr/bin:/bin' };
  delete env.RCF_FEEDBACK_DISABLE;
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function listIds(cwd) {
  const r = await rcf(cwd, ['feedback', 'list', '--json']);
  assert.equal(r.code, 0, `rcf feedback list --json exits 0 in ${cwd}\nstderr:\n${r.stderr}`);
  return JSON.parse(r.stdout).map((e) => [e.id, e.status]);
}

test('AC-16103-4: an entry rcf feedback add records in a linked git worktree is still listed pending by rcf feedback list from the main checkout after git worktree remove', async () => {
  const base = await scratchDir('rcf-fbs231-worktree-');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');
  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'WorktreeQueue' });
  await writeFile(join(main, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);

  const add = await rcf(lane, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', 'recorded in a lane worktree', '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code']);
  assert.equal(add.code, 0, `rcf feedback add records the entry in the worktree\nstderr:\n${add.stderr}`);
  const id = /recorded (fb-[0-9a-z-]+)/.exec(add.stdout)?.[1];
  assert.ok(id, `stdout names the recorded id: ${add.stdout}`);
  assert.deepEqual(await listIds(lane), [[id, 'pending']], 'fixture: the worktree lists the entry before the removal');

  git(main, 'worktree', 'remove', lane);
  assert.equal(existsSync(lane), false, 'fixture: git worktree remove (no --force) removed the worktree');

  assert.deepEqual(await listIds(main), [[id, 'pending']],
    'after the worktree is removed, rcf feedback list --json in the main checkout lists the entry, still pending');
  const plain = await rcf(main, ['feedback', 'list']);
  assert.ok(plain.stdout.includes(id), `rcf feedback list in the main checkout prints the entry id\nstdout:\n${plain.stdout}`);
});
