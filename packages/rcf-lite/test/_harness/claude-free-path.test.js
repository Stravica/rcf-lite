// The harness's pinned PATH contract (test/_harness/spawn.js). The PATH
// every child runs under reaches git and sh, and no agent CLI. On a host
// where git and sh sit in different directories (macOS: /usr/bin/git,
// /bin/sh only), a PATH holding git's directory alone leaves sh
// unreachable, so any child that runs a shell (npm's lifecycle scripts)
// fails to spawn it. The layouts here are synthetic, built in a scratch
// directory, so the contract is checked the same way on every host.
// Imports Node builtins and the harness only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { claudeFreePath, toolPath } from './spawn.js';
import { scratch } from './fixture.js';

// A directory holding one fake executable per name.
function binDir(root, name, tools) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const tool of tools) {
    const file = join(dir, tool);
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, 0o755);
  }
  return dir;
}

const split = (p) => p.split(delimiter).filter(Boolean);
const holding = (dirs, tool) => dirs.filter((d) => existsSync(join(d, tool)));
const pathOf = (...dirs) => dirs.join(delimiter);

// fn throws a harness error that names the offending directory.
function refusesNaming(fn, dir, what) {
  assert.throws(fn, (err) => err instanceof Error && err.message.startsWith('harness:') && err.message.includes(dir), what);
}

test('harness PATH: claudeFreePath keeps the directory that holds sh beside the one that holds git, still refuses any directory holding an agent CLI, and returns each directory once', (t) => {
  const root = scratch(t, 'rcf-h-path-');
  const gitOnly = binDir(root, 'a-git', ['git']);
  const shOnly = binDir(root, 'b-sh', ['sh']);
  const npmBesideClaude = binDir(root, 'c-npm-claude', ['npm', 'claude']);
  const gitBesideClaude = binDir(root, 'd-git-claude', ['git', 'claude']);
  const shBesideClaude = binDir(root, 'e-sh-claude', ['sh', 'claude']);
  const merged = binDir(root, 'f-git-sh', ['git', 'sh']);
  const neither = binDir(root, 'g-tar', ['tar']);

  // Kept as they were: an agent CLI in git's directory, npm beside an
  // agent CLI and a PATH with no git are each refused, and one directory
  // holding both git and sh (the merged-usr Linux layout) stays one.
  refusesNaming(() => claudeFreePath(pathOf(gitBesideClaude, shOnly)), gitBesideClaude, 'claudeFreePath refuses when the directory holding git also holds claude');
  refusesNaming(() => toolPath(['npm'], pathOf(gitOnly, shOnly, npmBesideClaude)), npmBesideClaude, 'toolPath refuses npm sitting beside claude');
  assert.throws(() => claudeFreePath(pathOf(neither, shOnly)), /no git/, 'claudeFreePath refuses a PATH with no git');
  assert.deepEqual(split(claudeFreePath(pathOf(merged))), [merged], 'a directory holding git and sh is returned alone, once');

  // The split layout: git in one directory, sh only in another.
  const got = split(claudeFreePath(pathOf(gitOnly, shOnly)));
  assert.equal(holding(got, 'sh').length, 1, `claudeFreePath reaches sh when git and sh sit in different directories: it returned ${JSON.stringify(got)}, and no returned directory holds sh`);
  assert.equal(holding(got, 'git').length, 1, `claudeFreePath reaches git: it returned ${JSON.stringify(got)}`);
  assert.deepEqual([...got].sort(), [gitOnly, shOnly].sort(), 'claudeFreePath returns exactly the directory holding git and the directory holding sh, each once');
  assert.equal(holding(got, 'claude').length, 0, 'no returned directory holds claude');

  // The directory holding sh is held to the same refusals.
  refusesNaming(() => claudeFreePath(pathOf(gitOnly, shBesideClaude)), shBesideClaude, 'claudeFreePath refuses when the directory holding sh also holds claude');
  assert.throws(() => claudeFreePath(pathOf(gitOnly, neither)), (err) => err instanceof Error && err.message.startsWith('harness:') && /\bsh\b/.test(err.message), 'claudeFreePath refuses a PATH with no sh, naming sh');

  // toolPath builds on the same directories and never repeats one.
  const tools = split(toolPath(['sh', 'git'], pathOf(gitOnly, shOnly)));
  assert.deepEqual([...tools].sort(), [gitOnly, shOnly].sort(), `toolPath(['sh', 'git']) returns the git and sh directories once each: it returned ${JSON.stringify(tools)}`);
  const onMerged = split(toolPath(['sh'], pathOf(merged, shOnly)));
  assert.deepEqual(onMerged, [merged], `toolPath(['sh']) adds no second directory when git's directory already holds sh: it returned ${JSON.stringify(onMerged)}`);
});
