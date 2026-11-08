// The harness's pinned PATH, end to end: npm pack, whose prepack
// lifecycle script npm runs through sh, under the PATH toolPath(['npm'])
// computes. The host layout is synthetic so the check is the same on
// every host: one directory links the real git, a second the real sh and
// a third the real node and npm, as on a host where git and sh sit in
// different directories (macOS: /usr/bin/git, /bin/sh only). npm reads
// no user or global config and keeps its cache and temp files in the
// scratch directory. Imports Node builtins and the harness only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { toolPath } from './spawn.js';
import { scratch } from './fixture.js';

const NODE_DIR = dirname(process.execPath);
const NPM_CLI = join(NODE_DIR, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

// The first directory on the inherited PATH holding tool.
function onPath(tool) {
  const dir = (process.env.PATH ?? '').split(delimiter).filter(Boolean).find((d) => existsSync(join(d, tool)));
  assert.ok(dir, `the host has ${tool} on its PATH`);
  return join(dir, tool);
}

// A directory of symlinks, name -> real file.
function linkDir(root, name, links) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [tool, target] of Object.entries(links)) symlinkSync(target, join(dir, tool));
  return dir;
}

function runNpm(args, { cwd, env }) {
  return new Promise((res) => {
    execFile(process.execPath, [NPM_CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : (err.killed ? 'timeout' : 1)) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

test('harness PATH: npm pack of a package with a prepack script exits 0 and runs the script under toolPath([\'npm\']) when git, sh and npm sit in three different directories', async (t) => {
  assert.ok(existsSync(NPM_CLI), `npm's CLI sits beside node at ${NPM_CLI}`);
  const root = scratch(t, 'rcf-h-npmsplit-');
  const gitDir = linkDir(root, 'a-git', { git: onPath('git') });
  const shDir = linkDir(root, 'b-sh', { sh: onPath('sh') });
  const npmDir = linkDir(root, 'c-node-npm', { node: process.execPath, npm: NPM_CLI });
  const path = toolPath(['npm'], [gitDir, shDir, npmDir].join(delimiter));

  const pkg = join(root, 'pkg');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({ name: 'split-path-fixture', version: '1.0.0', files: ['index.js'], scripts: { prepack: 'echo prepack ran > prepack-ran.txt' } }, null, 2)}\n`);
  writeFileSync(join(pkg, 'index.js'), 'export {};\n');
  const userrc = join(root, 'user-npmrc');
  const globalrc = join(root, 'global-npmrc');
  writeFileSync(userrc, '');
  writeFileSync(globalrc, '');
  const tmp = join(root, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const env = {
    HOME: root,
    PATH: path,
    TMPDIR: tmp,
    npm_config_userconfig: userrc,
    npm_config_globalconfig: globalrc,
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };

  const r = await runNpm(['pack', '--dry-run', '--json'], { cwd: pkg, env });
  assert.equal(r.code, 0, `npm pack --dry-run exits 0 under PATH=${path} (it exited ${r.code})\nstdout:\n${r.stdout.slice(-2000)}\nstderr:\n${r.stderr.slice(-2000)}`);
  const marker = join(pkg, 'prepack-ran.txt');
  assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : null, 'prepack ran\n', 'the prepack script ran through sh and wrote its marker');
});
