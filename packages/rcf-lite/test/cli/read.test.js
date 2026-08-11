// `rcf read <id>` subcommand tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-read-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'ReadTest' });
  return tmp;
}

test('rcf read REQ-001 prints pretty JSON by default', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['read', 'REQ-001']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.reqId, 'REQ-001');
});

test('rcf read REQ-001 returns the body and reports it valid against its schema (AC-301-1)', async () => {
  const tmp = await scaffold();
  const { code, stdout, stderr } = await runBin(tmp, ['read', 'REQ-001']);
  assert.equal(code, 0);
  // The document is returned...
  const body = JSON.parse(stdout);
  assert.equal(body.reqId, 'REQ-001');
  // ...and reported as valid against its schema.
  assert.match(stderr, /\[ok\] read: REQ-001 is valid against its schema/);
});

test('rcf read on an invalid-but-present document returns the content together with the validation errors (AC-301-3)', async () => {
  const tmp = await scaffold();
  // Wedge the document: strip the required `title` field so the file
  // exists on disk but fails schema validation at load time.
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  delete req.title;
  await writeFile(reqPath, `${JSON.stringify(req, null, 2)}\n`, 'utf8');

  const { code, stdout, stderr } = await runBin(tmp, ['read', 'REQ-001']);
  // Read is a retrieval verb, not a gate: exit 0 with both surfaces.
  assert.equal(code, 0);
  // The content comes back on stdout...
  const body = JSON.parse(stdout);
  assert.equal(body.reqId, 'REQ-001');
  assert.equal(body.title, undefined);
  // ...AND the validation errors come back on stderr - the caller sees
  // both the content and the problem in one read.
  assert.match(stderr, /\[warn\] read: REQ-001 fails schema validation/);
  assert.match(stderr, /\[warn\] validation REQ-001: .*title/);
});

test('rcf read REQ-001 --raw prints single-line JSON', async () => {
  const tmp = await scaffold();
  const { stdout } = await runBin(tmp, ['read', 'REQ-001', '--raw']);
  // Single-line JSON contains no newline before the closing brace.
  const trimmed = stdout.trim();
  assert.ok(!trimmed.includes('\n'));
  const body = JSON.parse(trimmed);
  assert.equal(body.reqId, 'REQ-001');
});

test('rcf read REQ-001 --field title prints just the title', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['read', 'REQ-001', '--field', 'title']);
  assert.equal(code, 0);
  assert.match(stdout, /TODO: name this requirement/);
});

test('rcf read AC-101-1 reads the inline AC entry from parent US', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['read', 'AC-101-1']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.id, 'AC-101-1');
});

test('rcf read UNKNOWN-999 exits 2 (usage, unknown id)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['read', 'UNKNOWN-999']);
  assert.equal(code, 2);
  assert.match(stderr, /not found/);
});

test('rcf read --help prints help', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['read', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf read/);
});
