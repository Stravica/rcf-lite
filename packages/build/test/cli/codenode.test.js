// Phase 10 (X2 CodeNode bridge) CLI-level tests: `rcf validate` staleCode
// floor + `--no-code` escape hatch (D6/D8), `rcf trace <path>` /
// `<path>#symbol` mode (D9), `--to-code` on trace/impact (D9/D10),
// and the end-to-end staleness demo (rename -> validate exit 3 -> repair
// -> clean) that proves the X2 headline claim on a real `rcf` invocation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
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
  const tmp = await mkdtemp(join(tmpdir(), `rcf-cn-cli-${name}-`));
  await initProject({ projectRoot: tmp, projectName: 'CnCliTest' });
  return tmp;
}

function cnDoc(overrides) {
  return {
    cnId: 'CN-001',
    path: 'src/example.js#exampleFn',
    implementsAcIds: ['AC-101-1'],
    dependencies: [],
    version: '0.1.0',
    status: 'draft',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

async function writeCn(root, doc) {
  await mkdir(join(root, 'rcf', 'code-nodes'), { recursive: true });
  await writeFile(join(root, 'rcf', 'code-nodes', `${doc.cnId.toLowerCase()}.json`), JSON.stringify(doc, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// D6/D8: validate staleness floor + --no-code escape hatch.
// ---------------------------------------------------------------------------

test('rcf validate is clean when a CN path resolves', async () => {
  const tmp = await scaffold('clean');
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  await writeCn(tmp, cnDoc());
  const { code, stdout } = await runBin(tmp, ['validate']);
  assert.equal(code, 0, stdout);
});

test('rcf validate exits 3 with staleCode when a CN file is missing', async () => {
  const tmp = await scaffold('stale-file');
  await writeCn(tmp, cnDoc({ path: 'src/does-not-exist.js' }));
  const { code, stdout, stderr } = await runBin(tmp, ['validate', '--json']);
  assert.equal(code, 3);
  const body = JSON.parse(stdout || stderr);
  assert.ok(body.issues.some((i) => i.kind === 'staleCode' && i.rule === 'fileResolves'));
});

test('rcf validate --no-code skips the staleness pass entirely (D8)', async () => {
  const tmp = await scaffold('no-code');
  await writeCn(tmp, cnDoc({ path: 'src/does-not-exist.js' }));
  const { code, stdout } = await runBin(tmp, ['validate', '--no-code']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /tree is clean/);
});

// ---------------------------------------------------------------------------
// STALENESS_DEMO: the headline claim, end-to-end, on a real `rcf` binary.
// Rename -> validate exit 3 staleCode -> repair the CN's path -> clean.
// ---------------------------------------------------------------------------

test('STALENESS_DEMO: file rename trips staleCode/fileResolves; a one-field repair returns the tree to clean', async () => {
  const tmp = await scaffold('demo-file-rename');
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'map-errors.js'), 'export function formatErrors() {}\n', 'utf8');
  await writeCn(tmp, cnDoc({ cnId: 'CN-010', path: 'src/map-errors.js#formatErrors', implementsAcIds: ['AC-101-1'] }));

  const before = await runBin(tmp, ['validate']);
  assert.equal(before.code, 0, before.stdout);

  // Competent refactor: rename the file.
  await rename(join(tmp, 'src', 'map-errors.js'), join(tmp, 'src', 'error-mapping.js'));

  const stale = await runBin(tmp, ['validate', '--json']);
  assert.equal(stale.code, 3);
  const staleBody = JSON.parse(stale.stdout || stale.stderr);
  const issue = staleBody.issues.find((i) => i.id === 'CN-010');
  assert.equal(issue.kind, 'staleCode');
  assert.equal(issue.rule, 'fileResolves');

  // Repair: one field edit via `rcf update`.
  const repair = await runBin(tmp, ['update', 'CN-010', '--set', 'path=src/error-mapping.js#formatErrors']);
  assert.equal(repair.code, 0, repair.stdout + repair.stderr);

  const after = await runBin(tmp, ['validate']);
  assert.equal(after.code, 0, after.stdout);
  assert.match(after.stdout, /tree is clean/);
});

// ---------------------------------------------------------------------------
// D9: `rcf trace <path>` / `<path>#symbol` mode.
// ---------------------------------------------------------------------------

test('rcf trace <path> resolves a file-level path to its CN(s) and traces backward to the PRD', async () => {
  const tmp = await scaffold('trace-path');
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  await writeCn(tmp, cnDoc());
  const { code, stdout } = await runBin(tmp, ['trace', 'src/example.js#exampleFn', '--format', 'json']);
  assert.equal(code, 0, stdout);
  const body = JSON.parse(stdout);
  assert.equal(body.pivot, 'CN-001');
  const ids = body.nodes.map((n) => n.id);
  assert.ok(ids.includes('AC-101-1'));
  assert.ok(ids.includes('PRD-001'));
});

test('rcf trace <path> on an unmatched path exits 2 (usage)', async () => {
  const tmp = await scaffold('trace-path-miss');
  const { code, stderr } = await runBin(tmp, ['trace', 'src/nope.js']);
  assert.equal(code, 2);
  assert.match(stderr, /not found/);
});

// ---------------------------------------------------------------------------
// D9/D10: --to-code on trace / impact.
// ---------------------------------------------------------------------------

test('rcf trace AC-101-1 --forward --to-code reaches the implementing CN; omitted it does not', async () => {
  const tmp = await scaffold('to-code');
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  await writeCn(tmp, cnDoc());

  const withCode = await runBin(tmp, ['trace', 'AC-101-1', '--forward', '--to-code', '--format', 'json']);
  assert.equal(withCode.code, 0, withCode.stdout);
  const withBody = JSON.parse(withCode.stdout);
  assert.ok(withBody.nodes.some((n) => n.id === 'CN-001'));

  const without = await runBin(tmp, ['trace', 'AC-101-1', '--forward', '--format', 'json']);
  assert.equal(without.code, 0);
  const withoutBody = JSON.parse(without.stdout);
  assert.ok(!withoutBody.nodes.some((n) => n.id === 'CN-001'));
});

test('rcf impact AC-101-1 --to-code labels the CN descendant re-verify-code', async () => {
  const tmp = await scaffold('impact-to-code');
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  await writeCn(tmp, cnDoc());
  const { code, stdout } = await runBin(tmp, ['impact', 'AC-101-1', '--to-code', '--format', 'json']);
  assert.equal(code, 0, stdout);
  const body = JSON.parse(stdout);
  const cnNode = body.nodes.find((n) => n.id === 'CN-001');
  assert.ok(cnNode);
  assert.equal(cnNode.actionNeeded, 're-verify-code');
});

// ---------------------------------------------------------------------------
// D1/D9: a spec-only tree (no code-nodes/ at all) behaves exactly as before.
// ---------------------------------------------------------------------------

test('D1/D9: spec-only tree with no code-nodes/ dir validates and traces exactly as pre-Phase-10', async () => {
  const tmp = await scaffold('spec-only');
  const validate = await runBin(tmp, ['validate']);
  assert.equal(validate.code, 0);
  const trace = await runBin(tmp, ['trace', 'REQ-001', '--forward', '--format', 'json']);
  assert.equal(trace.code, 0);
  const body = JSON.parse(trace.stdout);
  assert.ok(!body.nodes.some((n) => n.kind === 'codeNode'));
});
