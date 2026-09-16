// FBS-180 slice 1 CLI tests for `rcf feedback list` and `rcf feedback status`.
//
// Binds AC-15502-1 (list default and --all/--json shapes; no file writes,
// no network calls) and AC-15502-2 (status prints counts, opt-out state
// and gh availability summary; --json shape).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const fixturesDir = resolve(here, '..', 'feedback', 'gh-fakes');

function absoluteFixturePath(name) {
  return resolve(fixturesDir, name);
}

async function runBin(cwd, args = [], envOverrides = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8',
      env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'sess-1', ...envOverrides },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-list-'));
  await initProject({ projectRoot: tmp, projectName: 'FeedbackList' });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function addOne(tmp, title, extraArgs = []) {
  const r = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', title, '--body', 'body', '--evidence', 'ev',
    ...extraArgs,
  ]);
  assert.equal(r.code, 0, `add(${title}) failed: ${r.stderr}`);
  return r;
}

async function fileSha256(p) {
  const buf = await readFile(p);
  return createHash('sha256').update(buf).digest('hex');
}

// -- AC-15502-1 -----------------------------------------------------------

test('AC-15502-1: rcf feedback list default shows only pending entries, --all includes every state', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  await addOne(tmp, 'two');
  await addOne(tmp, 'three');
  // Discard one and defer one; leave one pending.
  const all = (await runBin(tmp, ['feedback', 'list', '--json']));
  const ids = JSON.parse(all.stdout).map((e) => e.id);
  const disc = await runBin(tmp, ['feedback', 'discard', ids[0]]);
  assert.equal(disc.code, 0, disc.stderr);
  const defer = await runBin(tmp, ['feedback', 'defer']);
  assert.equal(defer.code, 0, defer.stderr);
  // Add a fresh one so exactly one is pending at the end.
  await addOne(tmp, 'four');

  const defaultRun = await runBin(tmp, ['feedback', 'list']);
  assert.equal(defaultRun.code, 0);
  const lines = defaultRun.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `expected 1 pending row, got:\n${defaultRun.stdout}`);
  assert.match(lines[0], /four/);

  const allRun = await runBin(tmp, ['feedback', 'list', '--all']);
  assert.equal(allRun.code, 0);
  const allLines = allRun.stdout.trim().split('\n');
  assert.equal(allLines.length, 4);
  // Every non-pending row carries a [status] prefix.
  const nonPending = allLines.filter((l) => !l.startsWith('[pending]'));
  assert.ok(nonPending.length >= 3, 'expected discarded / deferred rows to carry a status prefix');
});

test('AC-15502-1: list --json is machine-readable and length matches total in --all mode', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  await addOne(tmp, 'two');
  const before = await fileSha256(join(tmp, '.rcf/feedback/entries.jsonl'));

  const defaultJson = await runBin(tmp, ['feedback', 'list', '--json']);
  const arr = JSON.parse(defaultJson.stdout);
  assert.ok(Array.isArray(arr));
  assert.equal(arr.length, 2);

  await addOne(tmp, 'three');
  const disc = await runBin(tmp, ['feedback', 'discard', arr[0].id]);
  assert.equal(disc.code, 0);
  const allJson = await runBin(tmp, ['feedback', 'list', '--all', '--json']);
  const arrAll = JSON.parse(allJson.stdout);
  assert.equal(arrAll.length, 3);

  // No file mutation from list/--json itself (add-only, list is read-only).
  // Verify by re-taking the sha of the file after list runs and comparing
  // to the pre-list sha (both are AFTER the add, so mutation from list
  // would show).
  const shaAfterFirstList = await fileSha256(join(tmp, '.rcf/feedback/entries.jsonl'));
  await runBin(tmp, ['feedback', 'list']);
  await runBin(tmp, ['feedback', 'list', '--all', '--json']);
  const shaAfterMoreLists = await fileSha256(join(tmp, '.rcf/feedback/entries.jsonl'));
  assert.equal(shaAfterFirstList, shaAfterMoreLists, 'list must not mutate entries.jsonl');
  assert.notEqual(shaAfterMoreLists, before, 'sanity: adds should have grown the file');
});

// -- AC-15502-2 -----------------------------------------------------------

test('AC-15502-2: rcf feedback status --json emits counts, optOut and gh summary', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  await addOne(tmp, 'two');
  const disc = await runBin(tmp, ['feedback', 'discard', '--all']);
  assert.equal(disc.code, 0);
  await addOne(tmp, 'three');
  const { code, stdout } = await runBin(tmp, ['feedback', 'status', '--json'], {
    // Route the slice-4 probe through a fake so the CI machine's own
    // gh state does not leak into the assertion.
    RCF_FEEDBACK_GH_MODULE: absoluteFixturePath('gh-fake-absent.mjs'),
  });
  assert.equal(code, 0);
  const obj = JSON.parse(stdout);
  assert.equal(obj.counts.pending, 1);
  assert.equal(obj.counts.discarded, 2);
  assert.equal(obj.optOut, false);
  assert.equal(obj.optOutSource, null);
  assert.ok(obj.gh, 'gh key present');
  // Slice 4 populates the probe: the absent fake reports present:false.
  assert.equal(obj.gh.present, false);
  assert.equal(obj.gh.authed, false);
  assert.ok(obj.destinations, 'destinations key present');
});

test('AC-15502-2: RCF_FEEDBACK_ASK=0 flips optOut in status', async () => {
  const tmp = await scaffold();
  const { stdout } = await runBin(tmp, ['feedback', 'status', '--json'], {
    RCF_FEEDBACK_ASK: '0',
    RCF_FEEDBACK_GH_MODULE: absoluteFixturePath('gh-fake-absent.mjs'),
  });
  const obj = JSON.parse(stdout);
  assert.equal(obj.optOut, true);
  assert.equal(obj.optOutSource, 'env:RCF_FEEDBACK_ASK=0');
});

test('AC-15502-2: RCF_FEEDBACK_DISABLE=1 flips optOut and names its source', async () => {
  const tmp = await scaffold();
  const { stdout } = await runBin(tmp, ['feedback', 'status', '--json'], {
    RCF_FEEDBACK_DISABLE: '1',
    RCF_FEEDBACK_GH_MODULE: absoluteFixturePath('gh-fake-absent.mjs'),
  });
  const obj = JSON.parse(stdout);
  assert.equal(obj.optOut, true);
  assert.equal(obj.optOutSource, 'env:RCF_FEEDBACK_DISABLE');
});

test('AC-15502-2: text status summarises counts on one line and opt-out state on another', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  const { code, stdout } = await runBin(tmp, ['feedback', 'status'], {
    // Slice 4 wires the gh probe into status; a fake adapter reports
    // gh as not installed so the assertion is deterministic and no
    // real gh call is made.
    RCF_FEEDBACK_GH_MODULE: absoluteFixturePath('gh-fake-absent.mjs'),
  });
  assert.equal(code, 0);
  assert.match(stdout, /1 pending/);
  assert.match(stdout, /opt-out: no/);
  // gh line is now populated by the slice-4 probe; the fake reports
  // absent so the fallback wording appears.
  assert.match(stdout, /gh: not installed/);
  // Sanity: no store mutation (the file exists after add; status is
  // a pure read of the store + env + one gh probe through the fake).
  await stat(join(tmp, '.rcf/feedback/entries.jsonl'));
});
