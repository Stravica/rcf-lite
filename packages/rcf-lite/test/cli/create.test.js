// `rcf create <kind>` subcommand tests. Drives the bin as a subprocess
// against a scaffolded tmpdir tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-create-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'CreateTest' });
  return tmp;
}

test('rcf create req --parent PRD-001 --title X writes a schema-valid REQ', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['define', 'create', 'req', '--parent', 'PRD-001', '--title', 'My REQ']);
  assert.equal(code, 0);
  assert.match(stdout, /REQ-002 created/);
  const req = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(req.prdId, 'PRD-001');
});

test('rcf create req without --parent exits 2 (usage)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'create', 'req', '--title', 'T']);
  assert.equal(code, 2);
  assert.match(stderr, /--parent is required/);
});

test('rcf create with unknown kind exits 2 (BUG-009: distinct unknown-kind message)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'create', 'nope', '--parent', 'PRD-001', '--title', 'T']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown kind: nope/);
});

test('rcf create us --parent REQ-999 exits 3 (brokenReference)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'create', 'us', '--parent', 'REQ-999', '--title', 'T']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf create ac --parent US-101 --description X replaces the seeded phantom in place', async () => {
  const tmp = await scaffold();
  // A freshly-initialised US carries one seeded placeholder AC-101-1 (schema
  // requires acceptanceCriteria minItems:1). The first operator-authored AC
  // must REPLACE that phantom instead of appending after it, so real ACs
  // land at -1 and audit coverage never counts the placeholder as
  // unmet criteria.
  const { code, stdout } = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'First real criterion']);
  assert.equal(code, 0);
  assert.match(stdout, /AC-101-1 created/);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria.length, 1);
  assert.equal(us.acceptanceCriteria[0].id, 'AC-101-1');
  assert.equal(us.acceptanceCriteria[0].description, 'First real criterion');
  // A subsequent create ac appends normally.
  const { code: code2, stdout: stdout2 } = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'Second criterion']);
  assert.equal(code2, 0);
  assert.match(stdout2, /AC-101-2 created/);
  const us2 = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us2.acceptanceCriteria.length, 2);
  assert.equal(us2.acceptanceCriteria[1].id, 'AC-101-2');
});

test('rcf create fbs --build-order collision exits 2 (§D6 amendment)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, [
    'define', 'create', 'fbs', '--parent', 'BS-001',
    '--title', 'clash', '--acs', 'AC-101-1', '--build-order', '1',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /collides with FBS-001/);
});

test('rcf create ts --parent US-101 writes TS-001', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, [
    'define', 'create', 'ts', '--parent', 'US-101',
    '--title', 'Smoke', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /TS-001 created/);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.usId, 'US-101');
  assert.equal(ts.status, 'draft');
});

test('rcf create tc mutates parent TS with derived slug', async () => {
  const tmp = await scaffold();
  await runBin(tmp, [
    'define', 'create', 'ts', '--parent', 'US-101',
    '--title', 'S', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  const { code, stdout } = await runBin(tmp, [
    'define', 'create', 'tc', '--parent', 'TS-001',
    '--ac', 'AC-101-1', '--description', 'happy',
    '--test-pointer', 'test/happy.test.js::happy',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /TC-001-happy created/);
});

// w-2026-07-28-005: a TC without a pointer is refused at the usage layer.
test('rcf create tc without --test-pointer exits 2 with the requirement named', async () => {
  const tmp = await scaffold();
  await runBin(tmp, [
    'define', 'create', 'ts', '--parent', 'US-101',
    '--title', 'S', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  const { code, stderr } = await runBin(tmp, [
    'define', 'create', 'tc', '--parent', 'TS-001',
    '--ac', 'AC-101-1', '--description', 'happy',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--test-pointer is required/);
});

test('rcf create --dry-run does not write the file', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, [
    'define', 'create', 'req', '--parent', 'PRD-001',
    '--title', 'Dry', '--dry-run',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /\[dry-run\]/);
});

test('rcf create --help prints the create help block', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['define', 'create', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Kinds:/);
});

// The help used to say only "--parent <id>  Required for every kind",
// never which KIND of id per kind. A TS hangs off a US (schema requires
// usId and forbids additional properties), but an agent driving the
// FBS-shaped build loop naturally reaches for --parent FBS-xxx and gets
// a brokenReference with no hint at what the right parent would be.
test('rcf create --help names the parent kind for every kind', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['define', 'create', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /req\s+-> PRD id/);
  assert.match(stdout, /us\s+-> REQ id/);
  assert.match(stdout, /ac -> US id/);
  assert.match(stdout, /tac\s+-> TAD id/);
  assert.match(stdout, /adr -> TAD id/);
  assert.match(stdout, /fbs -> BS id/);
  assert.match(stdout, /ts\s+-> US id/);
  assert.match(stdout, /tc\s+-> TS id/);
  assert.match(stdout, /cn\s+-> no --parent/);
});

// =============================================================================
// R1 extension to `rcf define create` (DEFINE step 3 ruling R1, PR 292
// follow-up 2026-10-05, w-2026-10-05-dave-013). Mirrors `rcf define
// ledger <name> add --id` behaviour: a repeat whose id already exists
// with identical content exits 0 and reports `unchanged`; a repeat
// whose id already exists with different content refuses with exit 3
// and a message naming the id and the differing field keys.

test('create CLI (R1 extension, AC-17302-13): create tac --id replay is unchanged exit 0, different content exits 3', async () => {
  const tmp = await scaffold();
  // Use `tac` as the exemplar kind: it has no post-create side effect
  // (req triggers the classifier that persists shapeClassification; a
  // replay-same-content would then show shapeClassification as a
  // differing field, which is a classifier concern not an R1 concern).
  // The semantics tested here apply to every kind; see TAC-4121 R1
  // addEntry (ledger) and src/core/store/writer.js createDocument for
  // the id-carried idempotency rule.
  const first = await runBin(tmp, [
    'define', 'create', 'tac', '--parent', 'TAD-001',
    '--id', 'TAC-005', '--title', 'My TAC',
    '--purpose', 'first purpose',
  ]);
  assert.equal(first.code, 0, `first create: ${first.stderr}`);
  const originalBody = await readFile(join(tmp, 'rcf/tacs/tac-005.json'), 'utf8');

  // Repeat with the same id and same content -> exit 0, unchanged.
  const same = await runBin(tmp, [
    'define', 'create', 'tac', '--parent', 'TAD-001',
    '--id', 'TAC-005', '--title', 'My TAC',
    '--purpose', 'first purpose',
  ]);
  assert.equal(same.code, 0, `same-content replay must exit 0; got ${same.code} / ${same.stderr}`);
  assert.match(same.stdout, /TAC-005: unchanged/);
  const sameBody = await readFile(join(tmp, 'rcf/tacs/tac-005.json'), 'utf8');
  assert.equal(sameBody, originalBody, 'on-disk file must be byte-identical after unchanged replay');

  // Repeat with the same id and different content -> exit 3, differing fields named.
  const conflict = await runBin(tmp, [
    'define', 'create', 'tac', '--parent', 'TAD-001',
    '--id', 'TAC-005', '--title', 'My TAC',
    '--purpose', 'second purpose',
  ]);
  assert.equal(conflict.code, 3, `different-content replay must exit 3; got ${conflict.code} / ${conflict.stderr}`);
  assert.match(conflict.stderr, /TAC-005/);
  assert.match(conflict.stderr, /purpose/);
  const conflictBody = await readFile(join(tmp, 'rcf/tacs/tac-005.json'), 'utf8');
  assert.equal(conflictBody, originalBody, 'on-disk file must be byte-identical after conflict refusal');
});

test('create CLI (R1 extension, AC-17302-10): create ac --id replay is unchanged exit 0, different content exits 3', async () => {
  const tmp = await scaffold();
  const usPath = join(tmp, 'rcf/user-stories/us-101.json');
  // First real AC replaces the seeded phantom at AC-101-1.
  const first = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'foo']);
  assert.equal(first.code, 0, `first create: ${first.stderr}`);
  assert.match(first.stdout, /AC-101-1 created/);
  const originalBody = await readFile(usPath, 'utf8');

  // Replay with --id and identical content -> exit 0, unchanged, US file untouched.
  const same = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--id', 'AC-101-1', '--description', 'foo']);
  assert.equal(same.code, 0, `same-content replay must exit 0; got ${same.code} / ${same.stderr}`);
  assert.equal(same.stdout, 'AC-101-1: unchanged (rcf/user-stories/us-101.json)\n');
  assert.equal(await readFile(usPath, 'utf8'), originalBody, 'US file must be byte-identical after unchanged replay');

  // --quiet suppresses the unchanged line (the line is the whole output; there is no --json).
  const quiet = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--id', 'AC-101-1', '--description', 'foo', '--quiet']);
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stdout, '');

  // Replay with different content -> exit 3 naming the id and the differing field.
  const conflict = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--id', 'AC-101-1', '--description', 'bar']);
  assert.equal(conflict.code, 3, `different-content replay must exit 3; got ${conflict.code} / ${conflict.stderr}`);
  assert.match(conflict.stderr, /conflict create ac: id AC-101-1 already exists with different content; differing fields: description\./);
  assert.equal(await readFile(usPath, 'utf8'), originalBody, 'US file must be byte-identical after conflict refusal');
});

test('create CLI (R1 extension, AC-17302-11): create tc --id replay is unchanged exit 0, different content exits 3', async () => {
  const tmp = await scaffold();
  const ts = await runBin(tmp, [
    'define', 'create', 'ts', '--parent', 'US-101',
    '--title', 'S', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  assert.equal(ts.code, 0, ts.stderr);
  const tsPath = join(tmp, 'rcf/test-suites/ts-001.json');
  const tcArgs = (description) => [
    'define', 'create', 'tc', '--parent', 'TS-001', '--id', 'TC-001-foo',
    '--ac', 'AC-101-1', '--description', description,
    '--test-pointer', 't.test.js::foo',
  ];
  const first = await runBin(tmp, tcArgs('foo'));
  assert.equal(first.code, 0, `first create: ${first.stderr}`);
  assert.match(first.stdout, /TC-001-foo created/);
  const originalBody = await readFile(tsPath, 'utf8');

  const same = await runBin(tmp, tcArgs('foo'));
  assert.equal(same.code, 0, `same-content replay must exit 0; got ${same.code} / ${same.stderr}`);
  assert.equal(same.stdout, 'TC-001-foo: unchanged (rcf/test-suites/ts-001.json)\n');
  assert.equal(await readFile(tsPath, 'utf8'), originalBody, 'TS file must be byte-identical after unchanged replay');

  const conflict = await runBin(tmp, tcArgs('bar'));
  assert.equal(conflict.code, 3, `different-content replay must exit 3; got ${conflict.code} / ${conflict.stderr}`);
  assert.match(conflict.stderr, /TC-001-foo/);
  assert.match(conflict.stderr, /differing fields: description\./);
  assert.equal(await readFile(tsPath, 'utf8'), originalBody, 'TS file must be byte-identical after conflict refusal');

  // Idempotency is id-carried: without --id a derived-slug collision still exits 2.
  const slugCollision = await runBin(tmp, [
    'define', 'create', 'tc', '--parent', 'TS-001',
    '--ac', 'AC-101-1', '--description', 'foo',
    '--test-pointer', 't.test.js::foo',
  ]);
  assert.equal(slugCollision.code, 2, `derived-slug collision must exit 2; got ${slugCollision.code} / ${slugCollision.stderr}`);
  assert.match(slugCollision.stderr, /slug collision on TC-001-foo, supply --slug explicitly/);
});

test('create CLI (R1 extension, AC-17302-12): create cn --id replay is unchanged exit 0, different content exits 3', async () => {
  const tmp = await scaffold();
  const cnArgs = (path) => ['define', 'create', 'cn', '--id', 'CN-001', '--path', path, '--acs', 'AC-101-1'];
  const first = await runBin(tmp, cnArgs('src/a.js'));
  assert.equal(first.code, 0, `first create: ${first.stderr}`);
  assert.match(first.stdout, /CN-001 created/);
  const cnPath = join(tmp, 'rcf/code-nodes/cn-001.json');
  const originalBody = await readFile(cnPath, 'utf8');

  const same = await runBin(tmp, cnArgs('src/a.js'));
  assert.equal(same.code, 0, `same-content replay must exit 0; got ${same.code} / ${same.stderr}`);
  assert.equal(same.stdout, 'CN-001: unchanged (rcf/code-nodes/cn-001.json)\n');
  assert.equal(await readFile(cnPath, 'utf8'), originalBody, 'CN file must be byte-identical after unchanged replay');

  const conflict = await runBin(tmp, cnArgs('src/b.js'));
  assert.equal(conflict.code, 3, `different-content replay must exit 3; got ${conflict.code} / ${conflict.stderr}`);
  assert.match(conflict.stderr, /CN-001/);
  assert.match(conflict.stderr, /differing fields: path\./);
  assert.equal(await readFile(cnPath, 'utf8'), originalBody, 'CN file must be byte-identical after conflict refusal');
});
