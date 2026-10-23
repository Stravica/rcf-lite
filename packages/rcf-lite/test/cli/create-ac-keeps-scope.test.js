// FBS-231 round 2 (US-17302, AC-17302-14): `rcf define create ac` keeps the
// criterion's scope field. Every test drives `node bin/rcf.js` as a child
// process in a fixture project and reads the written criterion back through
// `rcf define read <US>`, never from the input file.
//
// Forms covered: `create ac --parent <US> --from-file <json>` (scope, given,
// when, then and description in the file); `create ac --parent <US>
// --description <text> --from-file <json>` (scope, given, when, then in the
// file, merged under the CLI fields); a same-id replay (`--id`, AC-17302-10)
// of a criterion that carries scope with identical content. Guard: `create us
// --from-file` already keeps the scope of the criteria in its body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

function runBin(cwd, args) {
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 60_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function scaffold(prefix) {
  const tmp = await scratchDir(prefix);
  await initProject({ projectRoot: tmp, projectName: 'CreateKeepsScope' });
  await declareUiNoneForTests(tmp);
  return tmp;
}

async function readCriterion(cwd, usId, acId) {
  const r = await runBin(cwd, ['define', 'read', usId]);
  assert.equal(r.code, 0, `rcf define read ${usId} exits 0\nstderr:\n${r.stderr}`);
  const ac = JSON.parse(r.stdout).acceptanceCriteria.find((a) => a.id === acId);
  assert.ok(ac, `${usId} carries ${acId}`);
  return ac;
}

const BODY = {
  description: 'a criterion created with a scope',
  given: 'a fixture project',
  when: 'the verb runs',
  then: 'the record carries the scope',
  scope: 'runtime',
};

test('AC-17302-14: rcf define create ac --parent <US> --from-file <json> keeps the scope the file carries on the written criterion', async () => {
  const tmp = await scaffold('rcf-create-scope-file-');
  const file = join(tmp, 'ac-body.json');
  await writeFile(file, JSON.stringify(BODY), 'utf8');
  const r = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--from-file', file]);
  assert.equal(r.code, 0, `create ac exits 0\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /AC-101-1 created/);
  const ac = await readCriterion(tmp, 'US-101', 'AC-101-1');
  assert.equal(ac.scope, 'runtime', `the written criterion carries scope runtime: ${JSON.stringify(ac)}`);
  assert.deepEqual([ac.description, ac.given, ac.when, ac.then], [BODY.description, BODY.given, BODY.when, BODY.then],
    'description, given, when and then are kept as before');
});

test('AC-17302-14: rcf define create ac --parent <US> --description <text> --from-file <json> keeps the scope the file carries (CLI fields merged over the file)', async () => {
  const tmp = await scaffold('rcf-create-scope-merge-');
  const file = join(tmp, 'ac-body.json');
  await writeFile(file, JSON.stringify({ given: BODY.given, when: BODY.when, then: BODY.then, scope: 'library' }), 'utf8');
  const r = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--description', 'described on the command line', '--from-file', file]);
  assert.equal(r.code, 0, `create ac exits 0\nstderr:\n${r.stderr}`);
  const ac = await readCriterion(tmp, 'US-101', 'AC-101-1');
  assert.equal(ac.scope, 'library', `the written criterion carries scope library: ${JSON.stringify(ac)}`);
  assert.equal(ac.description, 'described on the command line', 'the CLI description wins');
});

test('AC-17302-14: a same-id replay (rcf define create ac --id) of a criterion that carries scope, with identical content, is unchanged (exit 0) and does not rewrite the file', async () => {
  const tmp = await scaffold('rcf-create-scope-replay-');
  const usPath = join(tmp, 'rcf/user-stories/us-101.json');
  const file = join(tmp, 'ac-body.json');
  await writeFile(file, JSON.stringify(BODY), 'utf8');
  const first = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--from-file', file]);
  assert.equal(first.code, 0, `fixture: first create\nstderr:\n${first.stderr}`);
  // The record matches the body whether or not the create kept the scope.
  const set = await runBin(tmp, ['define', 'update', 'AC-101-1', '--set', 'scope=runtime']);
  assert.equal(set.code, 0, `fixture: rcf define update sets the scope\nstderr:\n${set.stderr}`);
  const before = await readFile(usPath, 'utf8');

  const replay = await runBin(tmp, ['define', 'create', 'ac', '--parent', 'US-101', '--id', 'AC-101-1', '--from-file', file]);
  assert.equal(replay.code, 0, `identical replay exits 0; got ${replay.code}\nstderr:\n${replay.stderr}`);
  assert.equal(replay.stdout, 'AC-101-1: unchanged (rcf/user-stories/us-101.json)\n');
  assert.equal(await readFile(usPath, 'utf8'), before, 'the US file is byte-identical after the unchanged replay');
});

test('AC-17302-14 guard: rcf define create us --from-file keeps the scope of the criteria in its body', async () => {
  const tmp = await scaffold('rcf-create-scope-us-');
  const file = join(tmp, 'us-body.json');
  await writeFile(file, JSON.stringify({
    title: 'a story whose criterion carries a scope', asA: 'operator', iWant: 'a scoped criterion', soThat: 'coverage reads it',
    acceptanceCriteria: [{ id: 'AC-102-1', description: BODY.description, testable: true, given: BODY.given, when: BODY.when, then: BODY.then, scope: 'library' }],
  }), 'utf8');
  const r = await runBin(tmp, ['define', 'create', 'us', '--parent', 'REQ-001', '--from-file', file]);
  assert.equal(r.code, 0, `create us exits 0\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /US-102 created/);
  const ac = await readCriterion(tmp, 'US-102', 'AC-102-1');
  assert.equal(ac.scope, 'library', `the criterion keeps scope library: ${JSON.stringify(ac)}`);
});
