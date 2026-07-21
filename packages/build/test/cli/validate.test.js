// `rcf validate` subcommand tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-validate-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'ValidateTest' });
  return tmp;
}

test('rcf validate on a clean tree exits 0', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate']);
  assert.equal(code, 0);
  assert.match(stdout, /tree is clean/);
});

// ---- B4 regression (E2E matrix 2026-07-06-003) -----------------------------

test('rcf validate on a fresh scaffold exits 0 AND prints the TODO-placeholder notice (B4)', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate']);
  assert.equal(code, 0, 'the notice is informational - exit code unchanged');
  assert.match(stdout, /tree is clean/);
  assert.match(stdout, /notice: \d+ document\(s\) still carry scaffold TODO placeholder text/);
  // One line per affected doc: the scaffold REQ and PRD both carry TODOs.
  assert.match(stdout, /^ {2}PRD-001: /m);
  assert.match(stdout, /^ {2}REQ-001: /m);
});

test('rcf validate prints no TODO notice once placeholder text is gone (B4)', async () => {
  const tmp = await scaffold();
  // Turn the scaffold into a "real" tree: rewrite every string field that
  // carries TODO placeholder text. All affected fields are free strings
  // (minLength 1), so plain text keeps the tree schema-valid.
  const { readdir } = await import('node:fs/promises');
  const files = ['rcf/prd.json', 'rcf/tad.json', 'rcf/build-sequence.json'];
  for (const dir of ['requirements', 'user-stories', 'tacs', 'adrs', 'fbs', 'test-suites']) {
    for (const name of await readdir(join(tmp, 'rcf', dir))) {
      files.push(`rcf/${dir}/${name}`);
    }
  }
  const scrub = (value) => {
    if (typeof value === 'string') return /todo/i.test(value) ? 'authored content' : value;
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
    }
    return value;
  };
  for (const rel of files) {
    const path = join(tmp, rel);
    const doc = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, `${JSON.stringify(scrub(doc), null, 2)}\n`, 'utf8');
  }
  const { code, stdout } = await runBin(tmp, ['validate']);
  assert.equal(code, 0);
  assert.match(stdout, /tree is clean/);
  assert.doesNotMatch(stdout, /notice:/);
});

test('rcf validate --quiet suppresses the TODO notice (B4)', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate', '--quiet']);
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /notice:/);
});

test('rcf validate on a broken tree exits 3', async () => {
  const tmp = await scaffold();
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stderr } = await runBin(tmp, ['validate']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf validate --json emits a JSON envelope', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate', '--json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.issues, []);
});

test('rcf validate --json on broken tree exits 3 with issues[]', async () => {
  const tmp = await scaffold();
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stdout } = await runBin(tmp, ['validate', '--json']);
  assert.equal(code, 3);
  const body = JSON.parse(stdout);
  assert.equal(body.ok, false);
  assert.ok(body.issues.length > 0);
  assert.equal(body.issues[0].kind, 'brokenReference');
});

test('rcf validate --quiet suppresses per-issue output on clean tree', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate', '--quiet']);
  assert.equal(code, 0);
  // --quiet suppresses the "tree is clean" line but keeps the exit code.
  assert.equal(stdout, '');
});

test('rcf validate --help prints help', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['validate', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf validate/);
});

test('rcf validate outside a project exits 2', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-validate-noproject-'));
  const { code, stderr } = await runBin(tmp, ['validate']);
  assert.equal(code, 2);
  assert.match(stderr, /no project root found/);
});
