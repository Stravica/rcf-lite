// Phase 10 (X2 CodeNode bridge, D13) CLI-level tests: `rcf create cn`,
// `rcf update cn --set`, `rcf delete cn`, and the `--derive-deps`
// helpful-error path against the real binary (dependency-cruiser is not
// installed in this repo by design - zero-third-party-runtime-deps claim,
// Phase 9 D14 - so this exercises the genuine "not resolvable" path).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(name) {
  const tmp = await mkdtemp(join(tmpdir(), `rcf-cn-crud-cli-${name}-`));
  await initProject({ projectRoot: tmp, projectName: 'CnCrudCliTest' });
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  return tmp;
}

test('rcf create cn --path writes a file-level CN', async () => {
  const tmp = await scaffold('create');
  const { code, stdout } = await runBin(tmp, ['create', 'cn', '--path', 'src/example.js']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /CN-001 created at rcf\/code-nodes\/cn-001\.json/);
});

test('rcf create cn --path <path>#symbol --acs wires a symbol-level CN to an AC', async () => {
  const tmp = await scaffold('create-symbol');
  const { code, stdout } = await runBin(tmp, [
    'create', 'cn', '--path', 'src/example.js#exampleFn', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 0, stdout);
  const read = await runBin(tmp, ['read', 'CN-001']);
  const body = JSON.parse(read.stdout);
  assert.equal(body.path, 'src/example.js#exampleFn');
  assert.deepEqual(body.implementsAcIds, ['AC-101-1']);
});

test('rcf create cn without --path exits 2', async () => {
  const tmp = await scaffold('create-no-path');
  const { code, stderr } = await runBin(tmp, ['create', 'cn']);
  assert.equal(code, 2);
  assert.match(stderr, /--path is required/);
});

test('rcf create cn --deps wires a real CN-to-CN dependency edge', async () => {
  const tmp = await scaffold('create-deps');
  await runBin(tmp, ['create', 'cn', '--path', 'src/example.js#exampleFn']);
  const second = await runBin(tmp, ['create', 'cn', '--path', 'src/example.js', '--deps', 'CN-001']);
  assert.equal(second.code, 0, second.stdout);
  const trace = await runBin(tmp, ['trace', 'CN-001', '--forward', '--to-code', '--format', 'json']);
  const body = JSON.parse(trace.stdout);
  assert.ok(body.nodes.some((n) => n.id === 'CN-002'));
});

test('rcf delete cn is refused while depended-on, then succeeds with --cascade', async () => {
  const tmp = await scaffold('delete');
  await runBin(tmp, ['create', 'cn', '--path', 'src/example.js#exampleFn']);
  await runBin(tmp, ['create', 'cn', '--path', 'src/example.js', '--deps', 'CN-001']);
  const refused = await runBin(tmp, ['delete', 'CN-001']);
  assert.equal(refused.code, 4);
  const cascaded = await runBin(tmp, ['delete', 'CN-001', '--cascade']);
  assert.equal(cascaded.code, 0, cascaded.stdout);
  const validate = await runBin(tmp, ['validate']);
  assert.equal(validate.code, 0, validate.stdout);
});

// ---------------------------------------------------------------------------
// D5: --derive-deps helpful-error path (dependency-cruiser genuinely not
// installed in this repo - the zero-runtime-dep claim means it never is).
// ---------------------------------------------------------------------------

test('rcf create cn --derive-deps exits 2 with a helpful message when dependency-cruiser is not resolvable', async () => {
  const tmp = await scaffold('derive-deps-create');
  const { code, stderr } = await runBin(tmp, ['create', 'cn', '--path', 'src/example.js', '--derive-deps']);
  assert.equal(code, 2);
  assert.match(stderr, /dependency-cruiser is not resolvable/);
});

test('rcf update cn --derive-deps exits 2 with a helpful message when dependency-cruiser is not resolvable', async () => {
  const tmp = await scaffold('derive-deps-update');
  await runBin(tmp, ['create', 'cn', '--path', 'src/example.js']);
  const { code, stderr } = await runBin(tmp, ['update', 'CN-001', '--derive-deps']);
  assert.equal(code, 2);
  assert.match(stderr, /dependency-cruiser is not resolvable/);
});

test('rcf update --derive-deps on a non-cn id is refused', async () => {
  const tmp = await scaffold('derive-deps-wrong-kind');
  const { code, stderr } = await runBin(tmp, ['update', 'REQ-001', '--derive-deps']);
  assert.equal(code, 2);
  assert.match(stderr, /only applies to cn ids/);
});
