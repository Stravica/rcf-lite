// FBS-225 (US-19301) test helper: the package fixture world for
// `rcf verify run --artefact`.
//
// The world is a git repository that is both an rcf project (FBS-001 scoping
// AC-101-1 and AC-101-2, scaffolded by scaffoldChain) and a zero-dependency
// package fixture-cli 1.0.0 whose bin prints one line. Its test/cli.test.js
// spawns the bin by a path relative to the test file (../bin/), so a run that
// copies the test file beside the installed package exercises the artefact.
// TS/TC bindings are written through the rcf CLI; the tarball is real
// `npm pack` output, packed into a directory outside the repository. Every
// rcf run gets a recording fake `claude` first on PATH and an npm cache in
// the test's own temp dir (never the shared ~/.npm).

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareUiNoneForTests } from '../../_helpers/d0.js';
import { scratchDir } from '../../_helpers/scratch.js';
import { scaffoldChain } from './chain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RCF_BIN = resolve(HERE, '..', '..', '..', 'bin', 'rcf.js');

// The criteria's fixture names are FBS-001, AC-001-1, AC-001-2 and
// fixture-cli; scaffoldChain's user story is US-101, so its criteria are
// AC-101-1 and AC-101-2.
export const FBS = 'FBS-001';
export const AC1 = 'AC-101-1';
export const AC2 = 'AC-101-2';
export const PKG_NAME = 'fixture-cli';
export const PKG_VERSION = '1.0.0';
export const TARBALL = `${PKG_NAME}-${PKG_VERSION}.tgz`;
export const TEST_FILE = 'test/cli.test.js';
export const TITLE_1 = 'fixture-cli prints its name and version';
export const TITLE_2 = 'fixture-cli prints exactly one line';
export const MISSING_TITLE = 'fixture-cli answers --help';

// The real npm, resolved before any wrapper goes on PATH.
export const REAL_NPM = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

// Commit everything; trailers go in their own final paragraph.
export function commitAll(cwd, subject, trailers = {}) {
  git(cwd, 'add', '-A');
  const body = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`).join('\n');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', body ? `${subject}\n\n${body}` : subject);
  return git(cwd, 'rev-parse', 'HEAD');
}

// `git status --porcelain` paths, untracked files listed one by one.
export function changedPaths(root) {
  return git(root, 'status', '--porcelain', '--untracked-files=all')
    .split('\n').filter(Boolean).map((line) => line.slice(3));
}

// The parent's env minus the node:test child marker (a nested `node --test`
// that inherits it would report to this runner instead of printing TAP).
function baseEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// Run bin/rcf.js as a child; never rejects, returns the exit code.
export function rcf(args, { cwd, env } = {}) {
  return new Promise((res) => {
    execFile(process.execPath, [RCF_BIN, ...args], {
      cwd, env: env ?? baseEnv(), encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function acDoc(id) {
  return {
    id,
    description: `${id}: fixture-cli prints its banner`,
    given: 'fixture-cli is installed',
    when: 'the user runs it',
    then: 'it prints one line naming itself and its version',
    testable: true,
  };
}

function fbsDoc(executionStatus) {
  return {
    fbsId: FBS, prdId: 'PRD-001', bsId: 'BS-001', buildOrder: 1,
    executionStatus, title: `${FBS} fixture-cli`,
    summary: `${FBS} ships fixture-cli and binds ${AC1}, ${AC2}.`, acIds: [AC1, AC2], dependsOnFbsIds: [],
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
  };
}

const BIN_SOURCE = `#!/usr/bin/env node
export function banner() {
  return '${PKG_NAME} ${PKG_VERSION}';
}
console.log(banner());
`;

// test/cli.test.js. ac1: 'pass' | 'todo' | 'skip'; ac2: 'pass' | 'fail'
// (the AC-101-2 test then expects two lines, which the artefact never prints).
export function cliTestSource({ ac1 = 'pass', ac2 = 'pass' } = {}) {
  const t1 = ac1 === 'pass' ? 'test' : `test.${ac1}`;
  const lines = ac2 === 'fail' ? 2 : 1;
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', '${PKG_NAME}.js');
const run = () => execFileSync(process.execPath, [BIN], { encoding: 'utf8' });

${t1}(${JSON.stringify(TITLE_1)}, () => {
  assert.equal(run(), '${PKG_NAME} ${PKG_VERSION}\\n');
});

test(${JSON.stringify(TITLE_2)}, () => {
  assert.equal(run().split('\\n').filter(Boolean).length, ${lines});
});
`;
}

/**
 * Scaffold the world (not yet a git repository).
 *
 * @param {object} [o]
 * @param {'pass'|'todo'|'skip'} [o.ac1]
 * @param {'pass'|'fail'} [o.ac2]
 * @param {Array<[string, string]>} [o.bind] - [acId, test title] per TC
 * @param {object|null} [o.catalog] - rcf/verify-catalog.json probes
 * @param {string} [o.fbsStatus]
 */
export async function packageWorld({
  ac1 = 'pass', ac2 = 'pass', bind = [[AC1, TITLE_1], [AC2, TITLE_2]],
  catalog = null, fbsStatus = 'inProgress',
} = {}) {
  const { root } = await scaffoldChain({ acceptanceCriteria: [acDoc(AC1), acDoc(AC2)], fbsItems: [fbsDoc(fbsStatus)] });
  // D0: the CLI's define verbs refuse until the discovery journey is declared.
  await declareUiNoneForTests(root);
  const aux = await scratchDir('rcf-fbs225-aux-');
  const world = {
    root,
    aux,
    out: join(aux, 'packs'),
    npmCache: join(aux, 'npm-cache'),
    fakeBin: join(aux, 'fake-bin'),
    claudeMarker: join(aux, 'claude-invocations.log'),
    tcIds: {},
  };
  await mkdir(world.out, { recursive: true });
  await mkdir(world.npmCache, { recursive: true });
  await mkdir(world.fakeBin, { recursive: true });
  // AC-19301-8's method: a claude on PATH that records each call and fails.
  const claude = join(world.fakeBin, 'claude');
  await writeFile(claude, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${world.claudeMarker}'\nexit 1\n`, 'utf8');
  await chmod(claude, 0o755);

  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: PKG_NAME, version: PKG_VERSION, type: 'module',
    bin: { [PKG_NAME]: `bin/${PKG_NAME}.js` }, files: ['bin'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'bin', `${PKG_NAME}.js`), BIN_SOURCE, 'utf8');
  await chmod(join(root, 'bin', `${PKG_NAME}.js`), 0o755);
  await writeFile(join(root, TEST_FILE), cliTestSource({ ac1, ac2 }), 'utf8');
  if (catalog) {
    await writeFile(join(root, 'rcf', 'verify-catalog.json'),
      `${JSON.stringify({ catalogVersion: 1, probes: catalog }, null, 2)}\n`, 'utf8');
  }

  // TS/TC bindings through the CLI, as a test-author writes them.
  const ts = await rcf(['define', 'create', 'ts', '--parent', 'US-101', '--title', 'fixture-cli prints its banner',
    '--acs', `${AC1},${AC2}`, '--purpose', 'Bind the fixture-cli criteria to test/cli.test.js',
    '--test-level', 'integration'], { cwd: root });
  if (ts.code !== 0) throw new Error(`fixture: define create ts exit ${ts.code}\n${ts.stdout}${ts.stderr}`);
  world.tsId = (ts.stdout.match(/TS-[0-9]+/) ?? [])[0];
  if (!world.tsId) throw new Error(`fixture: no TS id in\n${ts.stdout}`);
  let n = 0;
  for (const [acId, title] of bind) {
    n += 1;
    const tc = await rcf(['define', 'create', 'tc', '--parent', world.tsId, '--ac', acId,
      '--slug', `case-${n}`, '--description', `${acId} through "${title}"`,
      '--test-pointer', `${TEST_FILE}::${title}`], { cwd: root });
    if (tc.code !== 0) throw new Error(`fixture: define create tc exit ${tc.code}\n${tc.stdout}${tc.stderr}`);
    const tcId = (tc.stdout.match(/TC-[A-Za-z0-9-]+/) ?? [])[0];
    world.tcIds[title] = tcId;
  }
  return world;
}

/** git init + commit the world at head H. */
export function commitWorld(world) {
  git(world.root, 'init', '-q', '-b', 'main');
  world.head = commitAll(world.root, 'fixture: fixture-cli 1.0.0 and its chain');
  return world.head;
}

/** `npm pack` at the current head into a directory outside the repository. */
export function packWorld(world) {
  execFileSync(REAL_NPM, ['pack', '--pack-destination', world.out], {
    cwd: world.root, env: { ...baseEnv(), npm_config_cache: world.npmCache, npm_config_update_notifier: 'false' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  world.tgz = join(world.out, TARBALL);
  if (!existsSync(world.tgz)) throw new Error(`fixture: npm pack wrote no ${world.tgz}`);
  return world.tgz;
}

/** The env every rcf run in the world gets: fake claude first on PATH, npm cache in aux. */
export function runEnv(world, extra = {}) {
  const env = baseEnv();
  env.PATH = `${world.fakeBin}:${extra.prependPath ? `${extra.prependPath}:` : ''}${process.env.PATH}`;
  env.npm_config_cache = world.npmCache;
  env.npm_config_update_notifier = 'false';
  if (extra.tmpdir) env.TMPDIR = extra.tmpdir;
  return env;
}

/**
 * The fixture's own suite, run once before an rcf run: top-level TAP test
 * lines as { ok, n, title, directive } so a test can assert the presumed
 * ok / not ok / todo / skip lines.
 */
export function selfCheck(world) {
  let out;
  try {
    out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', TEST_FILE], {
      cwd: world.root, env: baseEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    out = err.stdout ?? '';
  }
  return out.split('\n')
    .map((line) => line.match(/^(not ok|ok) (\d+) - (.*?)(?: # (TODO|SKIP)\b.*)?$/))
    .filter(Boolean)
    .map((m) => ({ ok: m[1] === 'ok', n: Number(m[2]), title: m[3], directive: m[4] ?? null }));
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function head12(world) {
  return world.head.slice(0, 12);
}

export function reportRel(world) {
  return `rcf/verify-reports/${FBS}/${head12(world)}.json`;
}

export function readReport(world) {
  return JSON.parse(readFileSync(join(world.root, reportRel(world)), 'utf8'));
}

/** Last non-empty stdout line. */
export function lastLine(stdout) {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  return lines[lines.length - 1] ?? '';
}

/** sha256 of every file under root (excluding .git/ and the excluded prefix), keyed by relative path. */
export function hashTree(root, excludePrefix) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs);
      if (rel === '.git' || `${rel}/`.startsWith(excludePrefix)) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else out[rel] = sha256(readFileSync(abs));
    }
  };
  walk(root);
  return out;
}

export function realTmp(dir) {
  return realpathSync(dir);
}
