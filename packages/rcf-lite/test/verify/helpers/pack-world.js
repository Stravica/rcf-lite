// FBS-226 (US-19302) test helper: additions to FBS-225's package fixture
// world (helpers/package-world.js) for the pack step and the install policy
// of `rcf verify run`. Nothing here changes an existing export of
// package-world.js; every function works on a world that packageWorld()
// already scaffolded.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { PKG_NAME, PKG_VERSION, REAL_NPM, commitAll, git } from './package-world.js';

/**
 * A recording npm for a PATH entry: runs the real npm, then appends one line
 * per call, `<cwd>\t<argv>\t<exit code>`, to its log. AC-19301-8's method,
 * with the exit code recorded so a test can pin what npm returned.
 */
export async function npmRecorder(world, name) {
  const dir = join(world.aux, `npm-wrap-${name}`);
  const log = join(world.aux, `npm-calls-${name}.log`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'npm'), `#!/bin/sh
wd="$(pwd -P)"
'${REAL_NPM}' "$@"
rc=$?
printf '%s\\t%s\\t%s\\n' "$wd" "$*" "$rc" >> '${log}'
exit $rc
`, 'utf8');
  await chmod(join(dir, 'npm'), 0o755);
  return {
    dir,
    log,
    async calls() {
      if (!existsSync(log)) return [];
      return (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => {
        const [cwd, argv, exit] = line.split('\t');
        return { cwd, argv: argv.split(' '), exitCode: Number(exit), line };
      });
    },
  };
}

/** The npm subcommand of a recorded call (the first argv word not a flag). */
export function subcommand(call) {
  return call.argv.find((a) => !a.startsWith('-')) ?? null;
}

/** Move the package (package.json and the bin's banner) to another version. */
export async function setVersion(world, version) {
  const pkgPath = join(world.root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const from = pkg.version;
  pkg.version = version;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  const binPath = join(world.root, 'bin', `${PKG_NAME}.js`);
  const src = await readFile(binPath, 'utf8');
  await writeFile(binPath, src.replace(`'${PKG_NAME} ${from}'`, `'${PKG_NAME} ${version}'`), 'utf8');
}

/** Declare a dependency in the package's package.json. */
export async function addDependency(world, name, range) {
  const pkgPath = join(world.root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [name]: range };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/** `npm pack` at the current head into world.out; returns the tarball path for that version. */
export function packAs(world, version = PKG_VERSION) {
  const env = { ...process.env, npm_config_cache: world.npmCache, npm_config_update_notifier: 'false' };
  delete env.NODE_TEST_CONTEXT;
  execFileSync(REAL_NPM, ['pack', '--pack-destination', world.out], {
    cwd: world.root, env,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tgz = join(world.out, `${PKG_NAME}-${version}.tgz`);
  if (!existsSync(tgz)) throw new Error(`fixture: npm pack wrote no ${tgz}`);
  return tgz;
}

/** Every *.tgz under root (excluding .git/), as relative paths. */
export function tarballsIn(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs);
      if (rel === '.git') continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.tgz')) out.push(rel);
    }
  };
  walk(root);
  return out;
}

// FBS-226 fix round (BH-1, BH-2, TD-1, TD-2): fixture shapes for the pack
// step. Each is opt-in; a world that never calls them is unchanged.

/** Edit the package's package.json in place. */
export async function editPackageJson(world, edit) {
  const pkgPath = join(world.root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  edit(pkg);
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/** Write a file at a path relative to the world root, creating its directory. */
export async function writeWorldFile(world, rel, content) {
  await mkdir(dirname(join(world.root, rel)), { recursive: true });
  await writeFile(join(world.root, rel), content, 'utf8');
}

/**
 * Give the package a `prepack` lifecycle script, scripts/prepack.mjs (outside
 * `files`, so never packed), with the given body. npm runs it with its cwd at
 * the package directory being packed.
 */
export async function setPrepack(world, body) {
  await writeWorldFile(world, 'scripts/prepack.mjs', body);
  await editPackageJson(world, (pkg) => { pkg.scripts = { ...(pkg.scripts ?? {}), prepack: 'node scripts/prepack.mjs' }; });
}

/**
 * A separate `npm pack` of the committed HEAD of the repository holding
 * world.root, from a fresh clone (no ignored or uncommitted content, no
 * lifecycle output left from an earlier pack). Returns the tarball and its sha256.
 */
export function cleanPackOf(world, name = 'clean') {
  const top = git(world.root, 'rev-parse', '--show-toplevel');
  const prefix = git(world.root, 'rev-parse', '--show-prefix');
  const clone = join(world.aux, `${name}-clone`);
  const out = join(world.aux, `${name}-packs`);
  git(world.aux, 'clone', '-q', top, clone);
  mkdirSync(out, { recursive: true });
  const env = { ...process.env, npm_config_cache: world.npmCache, npm_config_update_notifier: 'false' };
  delete env.NODE_TEST_CONTEXT;
  const json = execFileSync(REAL_NPM, ['pack', '--pack-destination', out, '--json'], {
    cwd: join(clone, prefix), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tgz = join(out, JSON.parse(json.slice(json.search(/^\[\s*$/m)))[0].filename);
  return { tgz, sha256: createHash('sha256').update(readFileSync(tgz)).digest('hex') };
}

/** The entry names of a tarball. */
export function tarballEntries(tgz) {
  return execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

/**
 * Move a scaffolded (not yet committed) world into a subdirectory of an outer
 * repository and commit it there: the dogfood shape, `--package .` from a
 * package directory inside its repository's work tree. world.root becomes the
 * subdirectory; world.head the outer repository's head.
 */
export function nestWorld(world, subdir = 'packages/fixture-cli') {
  const outer = join(world.aux, 'outer-repo');
  const root = join(outer, subdir);
  cpSync(world.root, root, { recursive: true });
  git(outer, 'init', '-q', '-b', 'main');
  world.root = root;
  world.head = commitAll(outer, 'fixture: fixture-cli nested in an outer repository');
  return world;
}

/** Whether root's repository's ignore files match a path (relative to root); the user's global excludes are not read. */
export function isIgnored(root, rel) {
  const r = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '-q', '--no-index', rel], { cwd: root });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore exit ${r.status}: ${r.stderr}`);
  return r.status === 0;
}
