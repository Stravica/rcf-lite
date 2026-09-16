// FBS-180 slice 1 unit tests for src/feedback/store.js.
//
// Covers fold-by-id, append semantics, ensureGitignore for the
// pre-write refusal, and the gitignore aggregator entry the managed
// block picks up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendEntry,
  appendState,
  ensureGitignore,
  entriesPath,
  feedbackDir,
  feedbackGitignoreEntry,
  newEntryId,
  readAskLedger,
  readEntries,
  statePath,
  storeExists,
  writeAskLedger,
} from '../../src/feedback/store.js';
import { managedGitignoreEntries } from '../../src/setup/managed-gitignore.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-feedback-store-'));
  return root;
}

test('feedbackGitignoreEntry is registered on the managed-gitignore aggregator', () => {
  const entries = managedGitignoreEntries();
  const hit = entries.find((e) => e.path === '.rcf/feedback/');
  assert.ok(hit, 'feedback entry should appear in managedGitignoreEntries()');
  assert.equal(hit.owner, feedbackGitignoreEntry.owner);
  assert.equal(hit.since, feedbackGitignoreEntry.since);
});

test('readEntries on a missing store returns []', async () => {
  const root = await fixture();
  assert.deepEqual(await readEntries(root), []);
  assert.equal(await storeExists(root), false);
});

test('appendEntry writes one JSONL line and readEntries returns it', async () => {
  const root = await fixture();
  await appendEntry(root, { id: 'fb-1', status: 'pending', title: 'x' });
  const all = await readEntries(root);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'fb-1');
  const text = await readFile(entriesPath(root), 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 1);
});

test('appendState folds by id (last line wins) and preserves order', async () => {
  const root = await fixture();
  await appendEntry(root, { id: 'fb-1', status: 'pending', title: 'one' });
  await appendEntry(root, { id: 'fb-2', status: 'pending', title: 'two' });
  await appendState(root, { id: 'fb-1', status: 'discarded', at: '2026-01-01T00:00:00Z' });
  const all = await readEntries(root);
  assert.equal(all.length, 2);
  assert.equal(all[0].id, 'fb-1');
  assert.equal(all[0].status, 'discarded');
  assert.equal(all[0].title, 'one', 'fold should preserve base fields');
  assert.equal(all[0].at, '2026-01-01T00:00:00Z');
  assert.equal(all[1].id, 'fb-2');
  assert.equal(all[1].status, 'pending');
});

test('readEntries skips malformed lines without throwing', async () => {
  const root = await fixture();
  await mkdir(feedbackDir(root), { recursive: true });
  await writeFile(entriesPath(root), 'not json\n{"id":"fb-ok","status":"pending"}\n', 'utf8');
  const all = await readEntries(root);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'fb-ok');
});

test('ensureGitignore accepts each of the four literal coverages', async () => {
  for (const line of ['.rcf/feedback/', '.rcf/feedback', '.rcf/', '.rcf']) {
    const root = await fixture();
    await writeFile(join(root, '.gitignore'), `${line}\n`, 'utf8');
    const check = await ensureGitignore(root);
    assert.deepEqual(check, { ok: true }, `expected ok for '${line}'`);
  }
});

test('ensureGitignore refuses on missing coverage and on absent .gitignore', async () => {
  const root = await fixture();
  const missing = await ensureGitignore(root);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /no \.gitignore/);
  await writeFile(join(root, '.gitignore'), 'node_modules\n', 'utf8');
  const uncovered = await ensureGitignore(root);
  assert.equal(uncovered.ok, false);
  assert.match(uncovered.reason, /\.rcf\/feedback\//);
});

test('newEntryId is deterministic under injected clock and rng', () => {
  const clock = new Date(Date.UTC(2026, 8, 16, 10, 0, 0));
  const rng = () => 0.5;
  const id = newEntryId(clock, rng);
  assert.match(id, /^fb-20260916-[0-9a-f]{12}$/);
  assert.equal(newEntryId(clock, rng), id, 'same clock+rng -> same id');
});

test('ask ledger round-trips through read and write', async () => {
  const root = await fixture();
  const empty = await readAskLedger(root);
  assert.deepEqual(empty, { asked: [], queueStateAt: null });
  await writeAskLedger(root, {
    asked: [{ sessionId: 'abc', askedAt: '2026-09-16T10:00:00Z' }],
    queueStateAt: '2026-09-16T10:05:00Z',
  });
  const back = await readAskLedger(root);
  assert.equal(back.asked.length, 1);
  assert.equal(back.asked[0].sessionId, 'abc');
  assert.equal(back.queueStateAt, '2026-09-16T10:05:00Z');
  const written = await readFile(statePath(root), 'utf8');
  assert.match(written, /"asked"/);
});

// -- review fix round (2026-09-16 slice 1-3 review) ---------------------

import { mintUniqueEntryId } from '../../src/feedback/store.js';

test('F-slice-1-01: gitignore guard honours ! negation (a later negation cancels a positive line)', async () => {
  const root = await fixture();
  // A gitignore with a positive line followed by an explicit
  // negation must not pass the guard - git would allow the tracked
  // path back and raw entries would leak on push.
  await writeFile(join(root, '.gitignore'), '.rcf/feedback/\n!.rcf/feedback/\n', 'utf8');
  const check = await ensureGitignore(root);
  assert.equal(check.ok, false, 'guard must refuse when a later negation cancels the positive line');
});

test('F-slice-1-01: gitignore guard passes when the negation is BEFORE the positive line (positive wins)', async () => {
  const root = await fixture();
  await writeFile(join(root, '.gitignore'), '!.rcf/feedback/\n.rcf/feedback/\n', 'utf8');
  const check = await ensureGitignore(root);
  assert.equal(check.ok, true, 'guard passes when the last-word line is the positive ignore');
});

test('F-slice-1-03: newEntryId tail is 12 hex characters (ruling R2, was 4-hex)', () => {
  const clock = new Date(Date.UTC(2026, 8, 16, 10, 0, 0));
  const rng = () => 0.5;
  const id = newEntryId(clock, rng);
  const tail = id.split('-').pop();
  assert.equal(tail.length, 12, 'F-slice-1-03: id tail must be 12 hex chars');
});

test('F-slice-1-03: mintUniqueEntryId regenerates on collision so two entries never share an id', async () => {
  const root = await fixture();
  // Seed an existing entry whose id matches what our rng will
  // generate on the first draw; the mint must probe and retry.
  const clock = new Date(Date.UTC(2026, 8, 16, 10, 0, 0));
  const seq = [0.5, 0.5, 0.5, 0.75, 0.75, 0.75]; // first draw collides, second draw wins
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const collide = newEntryId(clock, () => 0.5);
  await appendEntry(root, {
    id: collide, recordedAt: '2026-09-16T10:00:00Z', kind: 'core', status: 'pending',
    target: { ref: 'x' }, symptomClass: 'other', severity: 'minor', title: 't', body: 'b',
    evidence: [], environment: {}, askNow: false,
  });
  const fresh = await mintUniqueEntryId(root, clock, rng);
  assert.notEqual(fresh, collide, 'mint must not re-emit the colliding id');
  assert.match(fresh, /^fb-20260916-[0-9a-f]{12}$/);
});
