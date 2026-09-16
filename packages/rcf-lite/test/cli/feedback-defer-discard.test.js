// FBS-180 slice 1 CLI tests for `rcf feedback defer` and `rcf feedback discard`.
//
// Binds AC-15503-1 (defer appends a deferredUntilSession state line per
// pending entry with the current sessionId; entries stay in the log)
// and AC-15503-2 (discard <id> marks only named entries, --all discards
// every pending, discarded entries are hidden from list default).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = [], envOverrides = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8',
      env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'test-sess', ...envOverrides },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-defer-'));
  await initProject({ projectRoot: tmp, projectName: 'FeedbackDefer' });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function addOne(tmp, title) {
  const r = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', title, '--body', 'body', '--evidence', 'ev',
  ]);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.match(/fb-\d{8}-[0-9a-f]{4}/)?.[0] ?? null;
}

// -- AC-15503-1 -----------------------------------------------------------

test('AC-15503-1: defer appends a deferredUntilSession state line per pending entry', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  await addOne(tmp, 'two');
  const initialLines = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).length;
  assert.equal(initialLines, 2);

  const { code, stdout } = await runBin(tmp, ['feedback', 'defer'], { RCF_FEEDBACK_SESSION_ID: 'sess-abc' });
  assert.equal(code, 0);
  assert.match(stdout, /deferred 2 entries for session sess-abc/);

  const laterLines = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'))
    .split('\n').filter(Boolean);
  assert.equal(laterLines.length, 4, 'defer appends one state line per pending entry (2 + 2 = 4)');
  const deferred = laterLines.slice(2).map((l) => JSON.parse(l));
  for (const line of deferred) {
    assert.equal(line.status, 'deferredUntilSession');
    assert.equal(line.sessionId, 'sess-abc');
  }

  // Folded read: both entries now report deferredUntilSession.
  const listJson = await runBin(tmp, ['feedback', 'list', '--all', '--json']);
  const arr = JSON.parse(listJson.stdout);
  assert.equal(arr.length, 2);
  for (const e of arr) assert.equal(e.status, 'deferredUntilSession');
});

// -- AC-15503-2 -----------------------------------------------------------

test('AC-15503-2: discard <id> marks only named entries and hides them from list default', async () => {
  const tmp = await scaffold();
  const id1 = await addOne(tmp, 'one');
  const id2 = await addOne(tmp, 'two');
  const id3 = await addOne(tmp, 'three');
  assert.ok(id1 && id2 && id3);

  const disc = await runBin(tmp, ['feedback', 'discard', id1, id2]);
  assert.equal(disc.code, 0);
  assert.match(disc.stdout, /discarded 2 entries/);

  const list = await runBin(tmp, ['feedback', 'list']);
  assert.equal(list.code, 0);
  const rows = list.stdout.trim().split('\n');
  assert.equal(rows.length, 1);
  assert.match(rows[0], new RegExp(id3));

  const allJson = JSON.parse((await runBin(tmp, ['feedback', 'list', '--all', '--json'])).stdout);
  const byId = new Map(allJson.map((e) => [e.id, e]));
  assert.equal(byId.get(id1).status, 'discarded');
  assert.equal(byId.get(id2).status, 'discarded');
  assert.equal(byId.get(id3).status, 'pending');
});

test('AC-15503-2: discard --all marks every pending entry discarded', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'one');
  await addOne(tmp, 'two');
  const disc = await runBin(tmp, ['feedback', 'discard', '--all']);
  assert.equal(disc.code, 0);
  const list = await runBin(tmp, ['feedback', 'list']);
  assert.match(list.stdout, /^no pending feedback entries\./);
  const allJson = JSON.parse((await runBin(tmp, ['feedback', 'list', '--all', '--json'])).stdout);
  for (const e of allJson) assert.equal(e.status, 'discarded');
});

test('AC-15503-2: discard with an unknown id exits 2 and writes nothing', async () => {
  const tmp = await scaffold();
  await addOne(tmp, 'only');
  const before = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8')).length;
  const { code, stderr } = await runBin(tmp, ['feedback', 'discard', 'fb-does-not-exist']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown pending entry id/);
  const after = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8')).length;
  assert.equal(after, before, 'no state line written when discard refuses');
});
