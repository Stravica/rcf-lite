// Regression tests for BUG-002 (`rcf create tac` always fails schema
// validation because `title` leaks into a body whose schema uses `name`
// and forbids additional properties) and BUG-003 (`--title` cross-leaks
// into req/us/adr/fbs/ts bodies and cross-populates description/summary/
// purpose via a title-as-fallback chain).
//
// Post-fix contract:
//   • tac: no `title` field ever on disk; `--title X` seeds `name`.
//   • req/us/adr/fbs/ts: `title` is a proper schema field; `--title X`
//     lands there and does NOT bleed into description/summary/purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-title-mapping-'));
  await initProject({ projectRoot: tmp, projectName: 'TitleTest' });
  return tmp;
}

test('BUG-002: rcf create tac --title X succeeds (exit 0) and writes name=X, no title field', async () => {
  const tmp = await scaffold();
  const { code, stdout, stderr } = await runBin(tmp, [
    'create', 'tac', '--parent', 'TAD-001', '--title', 'Session Manager',
  ]);
  assert.equal(code, 0, `expected exit 0 (got ${code}), stderr=${stderr}`);
  assert.match(stdout, /TAC-002 created/);
  const tac = JSON.parse(await readFile(join(tmp, 'rcf/tacs/tac-002.json'), 'utf8'));
  // Schema forbids additional properties; a `title` field would be schema-invalid.
  assert.equal(
    Object.prototype.hasOwnProperty.call(tac, 'title'),
    false,
    'TAC must not have a `title` field on disk (schema forbids it)',
  );
  assert.equal(tac.name, 'Session Manager', '--title should seed TAC.name');
  assert.equal(tac.tacId, 'TAC-002');
  assert.equal(tac.tadId, 'TAD-001');
});

test('BUG-003 (req): --title lands in title, does not bleed into description', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'My REQ']);
  assert.equal(code, 0);
  const req = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(req.title, 'My REQ');
  assert.notEqual(
    req.description,
    'My REQ',
    'description should not be a duplicate of title — provide --description to set it',
  );
  assert.match(req.description, /TODO:/, 'description should default to a TODO placeholder');
});

test('BUG-003 (us): --title lands in title, does not bleed into other seed fields', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['create', 'us', '--parent', 'REQ-001', '--title', 'My US']);
  assert.equal(code, 0);
  // us-101 would collide with the scaffold; new US takes the next id under REQ-001.
  // We don't hard-code the path — walk the user-stories dir instead.
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(join(tmp, 'rcf/user-stories'));
  const target = files.find((f) => f !== 'us-101.json');
  assert.ok(target, `expected a newly created US alongside us-101.json, got ${files.join(', ')}`);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories', target), 'utf8'));
  assert.equal(us.title, 'My US');
  // asA/iWant/soThat should remain TODO seeds — --title must not leak into them.
  assert.match(us.asA, /TODO:/);
  assert.match(us.iWant, /TODO:/);
  assert.match(us.soThat, /TODO:/);
});

test('BUG-003 (adr): --title lands in title as a schema-required field', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['create', 'adr', '--parent', 'TAD-001', '--title', 'My ADR']);
  assert.equal(code, 0);
  const adr = JSON.parse(await readFile(join(tmp, 'rcf/adrs/adr-002.json'), 'utf8'));
  assert.equal(adr.title, 'My ADR');
  assert.match(adr.context, /TODO:/);
  assert.match(adr.decision, /TODO:/);
});

test('BUG-003 (fbs): --title lands in title, does not bleed into summary', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, [
    'create', 'fbs', '--parent', 'BS-001', '--title', 'My FBS', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 0, `expected exit 0 (got ${code}), stderr=${stderr}`);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-002.json'), 'utf8'));
  assert.equal(fbs.title, 'My FBS');
  assert.notEqual(
    fbs.summary,
    'My FBS',
    'summary should not be a duplicate of title — provide --summary via --from-file to set it',
  );
});

test('BUG-003 (ts): --title lands in title, does not bleed into purpose', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, [
    'create', 'ts', '--parent', 'US-101', '--title', 'My TS',
    '--purpose', 'Some purpose', '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 0, `expected exit 0 (got ${code}), stderr=${stderr}`);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.title, 'My TS');
  assert.equal(ts.purpose, 'Some purpose');
});
