// Issue #336: on Linux the Node built-in recursive fs.watch reports the
// first rename over a file, then goes permanently blind to that path
// (write-temp-then-rename editors silently stop updating the live view).
//
// The fix re-arms the base watcher on a rename event: close the current
// handle and open a new one, which re-registers the inotify watches
// against current inodes. These tests prove the re-arm logic through an
// injectable `fsWatchImpl` seam so the Linux-only delivery pattern can
// be driven deterministically on any host.
//
// Platform note. macOS fs.watch does not exhibit the rename-blind quirk,
// so a real-fs test with two rename-saves would pass on macOS even
// pre-fix; the simulated Linux path below is the one that proves re-arm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch } from '../../src/watch/index.js';

function makeFakeFsWatch() {
  // Simulates Linux fs.watch recursive: each handle delivers rename
  // events for its lifetime; after it is closed the test opens a new
  // one, which stands in for the re-armed inotify descriptors.
  const handles = [];
  function fsWatchImpl(_dir, _opts, listener) {
    const handle = {
      listener,
      closed: false,
      errorListeners: [],
      close() { this.closed = true; },
      on(name, cb) { if (name === 'error') this.errorListeners.push(cb); },
      // Test-side helper: fire a filesystem event to the live listener.
      // The handle only delivers while open.
      emit(eventType, filename) {
        if (this.closed) return;
        this.listener(eventType, filename);
      },
    };
    handles.push(handle);
    return handle;
  }
  return { fsWatchImpl, handles };
}

function manualTimers() {
  // One pending callback at a time (the primitive clears on reschedule).
  // The test flushes by calling `fire()`.
  let pending = null;
  return {
    timers: {
      setTimeout: (fn) => { pending = fn; return { unref() {} }; },
      clearTimeout: () => { pending = null; },
    },
    fire() { const fn = pending; pending = null; if (fn) fn(); },
    hasPending() { return pending !== null; },
  };
}

test('re-arms on a rename event: a later rename on the same path is reported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-rearm-'));
  try {
    const { fsWatchImpl, handles } = makeFakeFsWatch();
    const { timers, fire } = manualTimers();
    const events = [];
    const w = watch({
      paths: [dir],
      onChange: (ev) => events.push(ev),
      debounceMs: 30,
      fsWatchImpl,
      timers,
    });

    assert.equal(handles.length, 1, 'one base watcher is opened on start');

    // First rename-save: Linux reports this before going blind.
    handles[0].emit('rename', 'a.json');
    // Drain the microtask queue so `classify()` resolves before the
    // flush fires.
    await new Promise((r) => setTimeout(r, 20));
    fire();

    assert.equal(events.length, 1, 'first rename reaches onChange');
    assert.ok(events[0].path.endsWith('a.json'));

    assert.equal(handles.length, 2, 'base watcher is re-armed after the rename');
    assert.equal(handles[0].closed, true, 'old handle is closed on re-arm');
    assert.equal(handles[1].closed, false, 'new handle is live');

    // Second rename-save: the pre-fix Linux delivery drops this on the
    // old handle. The new handle (post re-arm) carries it through.
    handles[1].emit('rename', 'a.json');
    await new Promise((r) => setTimeout(r, 20));
    fire();

    assert.equal(events.length, 2, 'second rename reaches onChange after re-arm');
    assert.ok(events[1].path.endsWith('a.json'));

    w.close();
    assert.equal(handles[1].closed, true, 'close() tears down the live handle');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plain change events do not re-arm', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-no-rearm-'));
  try {
    const { fsWatchImpl, handles } = makeFakeFsWatch();
    const { timers, fire } = manualTimers();
    const events = [];
    const w = watch({
      paths: [dir],
      onChange: (ev) => events.push(ev),
      debounceMs: 30,
      fsWatchImpl,
      timers,
    });

    handles[0].emit('change', 'a.json');
    await new Promise((r) => setTimeout(r, 20));
    fire();

    assert.equal(events.length, 1);
    assert.equal(handles.length, 1, 'a plain change does not open a second handle');

    w.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a rename on a filtered path (non-json) still re-arms the base', async () => {
  // The watch descriptor becoming stale is not conditional on our
  // filter: a .log rotate over the tree can invalidate inotify just as
  // a .json rename does, so we re-arm on any rename inside the base.
  // (The filtered event itself is not reported to onChange.)
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-rearm-filtered-'));
  try {
    const { fsWatchImpl, handles } = makeFakeFsWatch();
    const { timers, fire } = manualTimers();
    const events = [];
    const w = watch({
      paths: [dir],
      onChange: (ev) => events.push(ev),
      debounceMs: 30,
      fsWatchImpl,
      timers,
    });

    handles[0].emit('rename', 'rotated.log');
    await new Promise((r) => setTimeout(r, 20));
    fire();

    assert.equal(events.length, 0, 'filtered path is not surfaced');
    assert.equal(handles.length, 2, 'base is still re-armed');

    w.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('coalesces a burst of rename events into one re-arm per flush window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-watch-rearm-burst-'));
  try {
    const { fsWatchImpl, handles } = makeFakeFsWatch();
    const { timers, fire } = manualTimers();
    const events = [];
    const w = watch({
      paths: [dir],
      onChange: (ev) => events.push(ev),
      debounceMs: 30,
      fsWatchImpl,
      timers,
    });

    handles[0].emit('rename', 'a.json');
    handles[0].emit('rename', 'b.json');
    handles[0].emit('rename', 'c.json');
    await new Promise((r) => setTimeout(r, 20));
    fire();

    assert.equal(handles.length, 2, 'the burst produces one re-arm, not three');
    assert.equal(handles[0].closed, true);

    w.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
