// Shared test helper for FBS-222 (rcf audit separation): fixture git
// histories in scratch dirs, isolated from the host's git config.
//
// `gitWorld(t)` makes a scratch dir holding an empty global git config,
// a local bare `origin.git` and a `repo` on `main` with one base commit
// pushed to that origin (so `origin/main` resolves with no network),
// then checks out `feature`. `commitPaths` writes the named paths and
// commits them with an optional `Hand:` value as a real trailer
// (`git commit --trailer`). `readHistory` reads the range back through
// the trailers format key and `--name-only`, so a test can assert the
// fixture it built before it runs rcf.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { scratchDir } from './scratch.js';

// Every git and rcf child gets this env: no system or global config,
// no prompts, fixed identity. Dates are set per commit.
export function isolatedEnv(root, extra = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-19T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-19T00:00:00Z',
    ...extra,
  };
}

export function git(world, cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: isolatedEnv(world.root, extraEnv), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function gitWorld(t, { baseFiles = { 'README.md': '# fixture\n' } } = {}) {
  const root = await scratchDir(t, 'rcf-separation-');
  writeFileSync(join(root, 'gitconfig'), '');
  const world = { root, repo: join(root, 'repo'), origin: join(root, 'origin.git'), tick: 0 };
  git(world, root, ['init', '-q', '--bare', '-b', 'main', world.origin]);
  git(world, root, ['init', '-q', '-b', 'main', world.repo]);
  writeFiles(world.repo, baseFiles);
  git(world, world.repo, ['add', '-A']);
  commit(world, 'base', null);
  git(world, world.repo, ['remote', 'add', 'origin', world.origin]);
  git(world, world.repo, ['push', '-q', 'origin', 'main']);
  git(world, world.repo, ['checkout', '-q', '-b', 'feature']);
  return world;
}

function writeFiles(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

function commit(world, subject, hand, extra = []) {
  world.tick += 1;
  const when = `2026-10-19T00:${String(world.tick).padStart(2, '0')}:00Z`;
  const trailer = hand ? ['--trailer', `Hand: ${hand}`] : [];
  git(world, world.repo, ['commit', '-q', ...extra, ...trailer, '-m', subject],
    { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  return git(world, world.repo, ['rev-parse', 'HEAD']);
}

// Write each path (content unique to the commit) and commit only those
// paths; `hand` null means no Hand: trailer (an undeclared commit).
export function commitPaths(world, subject, paths, hand) {
  writeFiles(world.repo, Object.fromEntries(paths.map((p) => [p, `${subject}: ${p}\n`])));
  git(world, world.repo, ['add', '--', ...paths]);
  return commit(world, subject, hand);
}

// A merge commit with no Hand: trailer that brings `branch` into HEAD.
export function mergeBranch(world, branch, subject) {
  git(world, world.repo, ['merge', '-q', '--no-ff', '--no-edit', '-m', subject, branch],
    { GIT_AUTHOR_DATE: '2026-10-19T01:00:00Z', GIT_COMMITTER_DATE: '2026-10-19T01:00:00Z' });
  return git(world, world.repo, ['rev-parse', 'HEAD']);
}

// The range origin/main's merge-base to HEAD, oldest first: one entry per
// commit with its parents, Hand: trailer values and the paths it names.
export function readHistory(world) {
  const shas = git(world, world.repo, ['rev-list', '--reverse', 'origin/main..HEAD']).split('\n').filter(Boolean);
  return shas.map((sha) => {
    const out = git(world, world.repo, ['log', '-1', '--name-only',
      '--format=%P%x1f%(trailers:key=Hand,valueonly,separator=%x1e)%x1f%s%x1f', sha]);
    const [parents, hands, subject, rest] = out.split('\x1f');
    return {
      sha,
      parents: parents.split(' ').filter(Boolean),
      hands: hands ? hands.split('\x1e') : [],
      subject,
      paths: rest.split('\n').filter(Boolean).sort(),
    };
  });
}

export function baseAndHead(world) {
  const base = git(world, world.repo, ['merge-base', 'origin/main', 'HEAD']);
  const head = git(world, world.repo, ['rev-parse', 'HEAD']);
  return { base, head };
}

// `git status --porcelain --untracked-files=all` plus a hash over every
// file outside .git (path and bytes).
export function treeState(world) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(`${relative(world.repo, full)}\0`).update(readFileSync(full)).update('\0');
    }
  };
  walk(world.repo);
  return {
    status: git(world, world.repo, ['status', '--porcelain', '--untracked-files=all']),
    tree: hash.digest('hex'),
  };
}

// Run bin/rcf.js with the isolated env; never throws.
export function runRcf(world, bin, args, { cwd = world.repo, env = {} } = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd, env: isolatedEnv(world.root, env), encoding: 'utf8', timeout: 60_000,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
