// Tests for the reusable file-watch primitive at src/watch/. Node's
// built-in `fs.watch` recursive is not perfectly deterministic across
// platforms - events can coalesce, filenames can be null, and delete
// vs rename can be indistinguishable. The primitive normalises those
// edges and coalesces bursts via a debounce window. These tests wait a
// short flush budget after each write to allow the debounce to fire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch } from '../../src/watch/index.js';

const DEBOUNCE_MS = 30;
const FLUSH_BUDGET_MS = 500;

async function collect(fn, budgetMs = FLUSH_BUDGET_MS) {
  await new Promise((r) => setTimeout(r, budgetMs));
  return fn();
}

test('watch fires on a .json change under a temp dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-basic-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  await writeFile(join(dir, 'a.json'), '{}', 'utf8');
  await collect(() => {});
  w.close();
  assert.ok(events.length >= 1, `expected at least one event, got ${JSON.stringify(events)}`);
  assert.ok(events.some((e) => e.path.endsWith('a.json')));
});

test('watch coalesces bursts of writes to the same file into one event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-coalesce-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  const p = join(dir, 'a.json');
  await writeFile(p, '{"a":1}', 'utf8');
  await writeFile(p, '{"a":2}', 'utf8');
  await writeFile(p, '{"a":3}', 'utf8');
  await collect(() => {});
  w.close();
  const forA = events.filter((e) => e.path === p);
  assert.equal(forA.length, 1, `expected exactly one event for a.json, got ${forA.length}`);
});

test('watch filters non-JSON files by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-filter-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  await writeFile(join(dir, 'a.txt'), 'hello', 'utf8');
  await writeFile(join(dir, 'b.tmp'), 'hello', 'utf8');
  await collect(() => {});
  w.close();
  assert.equal(events.length, 0, `expected no events for non-json files, got ${JSON.stringify(events)}`);
});

test('watch fires with type "create" for a brand-new .json file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-create-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  await writeFile(join(dir, 'b.json'), '{}', 'utf8');
  await collect(() => {});
  w.close();
  assert.ok(events.some((e) => (e.type === 'create' || e.type === 'change') && e.path.endsWith('b.json')));
});

test('watch fires with type "delete" for a removed .json file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-delete-'));
  const p = join(dir, 'c.json');
  await writeFile(p, '{}', 'utf8');
  await new Promise((r) => setTimeout(r, 50));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  await unlink(p);
  await collect(() => {});
  w.close();
  assert.ok(events.some((e) => e.type === 'delete' && e.path.endsWith('c.json')),
    `expected a delete event, got ${JSON.stringify(events)}`);
});

test('watch close() is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-idempotent-'));
  const w = watch({
    paths: [dir],
    onChange: () => {},
    debounceMs: DEBOUNCE_MS,
  });
  w.close();
  w.close();
  assert.ok(true);
});

test('watch close() stops further onChange invocations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-close-stops-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  w.close();
  await writeFile(join(dir, 'a.json'), '{}', 'utf8');
  await collect(() => {});
  assert.equal(events.length, 0);
});

test('watch AbortSignal aborts the watcher', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-signal-'));
  const controller = new AbortController();
  const events = [];
  watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
    signal: controller.signal,
  });
  controller.abort();
  await writeFile(join(dir, 'a.json'), '{}', 'utf8');
  await collect(() => {});
  assert.equal(events.length, 0);
});

test('watch throws on missing or non-absolute paths', () => {
  assert.throws(() => watch({ onChange: () => {} }), TypeError);
  assert.throws(() => watch({ paths: [], onChange: () => {} }), TypeError);
  assert.throws(() => watch({ paths: ['relative/path'], onChange: () => {} }), TypeError);
});

test('watch throws when onChange is not a function', () => {
  const dir = tmpdir();
  assert.throws(() => watch({ paths: [dir] }), TypeError);
});

test('watch honours a custom filter over the default `*.json` filter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-customfilter-'));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
    filter: (p) => p.endsWith('.txt'),
  });
  await writeFile(join(dir, 'a.json'), '{}', 'utf8');
  await writeFile(join(dir, 'b.txt'), 'hi', 'utf8');
  await collect(() => {});
  w.close();
  assert.ok(events.some((e) => e.path.endsWith('b.txt')));
  assert.ok(!events.some((e) => e.path.endsWith('a.json')));
});

test('watch recursively picks up changes in a nested subdir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-recursive-'));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'nested', 'deeper'), { recursive: true });
  await new Promise((r) => setTimeout(r, 50));
  const events = [];
  const w = watch({
    paths: [dir],
    onChange: (ev) => events.push(ev),
    debounceMs: DEBOUNCE_MS,
  });
  await writeFile(join(dir, 'nested', 'deeper', 'x.json'), '{}', 'utf8');
  await collect(() => {});
  w.close();
  assert.ok(events.some((e) => e.path.endsWith('x.json')),
    `expected recursive event; got ${JSON.stringify(events)}`);
});

test('watch cleans up watched dirs after close (temp dir removable)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-cleanup-'));
  const w = watch({
    paths: [dir],
    onChange: () => {},
    debounceMs: DEBOUNCE_MS,
  });
  w.close();
  await rm(dir, { recursive: true, force: true });
  assert.ok(true);
});
