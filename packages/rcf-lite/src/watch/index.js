// Reusable file-watch primitive. Node 24 built-in `fs.watch` recursive
// with a debounce window. The view server imports this; Phase 5's
// `rcf validate --watch` will import it independently. Neither surface
// depends on the other.
//
// D6: exposed as a shared primitive; view server is one caller, validate
// --watch will be another.
// D8: Node built-in `fs.watch` recursive - no `chokidar` dep. If dogfood
// surfaces a failure mode the built-in cannot handle, the swap-in is
// banked (same module interface, no caller changes).
//
// Issue #336 (reporter Dex, 2026-10-08): on Linux the recursive fs.watch
// reports the first rename over a file, then goes permanently blind to
// that path (next rename or write never fires). Editors that save by
// write-temp-then-rename (vim backupcopy=no, JetBrains safe-write) hit
// this on every save. Fix: on any `rename` event under a watched base,
// re-arm that base (close the stale handle, open a new one). The re-arm
// coalesces onto the debounce window, so a burst of renames yields one
// re-arm per flush. No dependency added.

import { watch as defaultFsWatch } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Watch one or more directories recursively for JSON file changes and
 * fire `onChange` once per unique path per debounce window.
 *
 * @param {object} args
 * @param {string[]} args.paths - absolute directory paths to watch
 * @param {(event: { type: 'create' | 'change' | 'delete', path: string }) => void} args.onChange
 * @param {number} [args.debounceMs=50] - coalescing window in ms
 * @param {AbortSignal} [args.signal] - external cancellation
 * @param {(err: Error) => void} [args.onError] - fired on watcher failure
 * @param {(path: string) => boolean} [args.filter] - override default `*.json` filter
 * @param {{ setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [args.timers]
 *   - injectable timer functions for the debounce flush. Defaults to the
 *   globals. Exists as a determinism seam for tests: a manual timer lets a
 *   test decide exactly when the debounce window closes instead of racing
 *   real fs-event delivery latency. Production callers never pass this.
 * @param {typeof defaultFsWatch} [args.fsWatchImpl] - injectable fs.watch
 *   implementation. Issue #336 seam: a test substitutes a fake that
 *   drives the Linux rename-blind delivery pattern deterministically
 *   on any host. Production callers never pass this.
 * @returns {{ close: () => void }}
 */
export function watch({
  paths,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  signal,
  onError,
  filter,
  timers,
  fsWatchImpl,
} = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError('watch: paths must be a non-empty array of absolute paths');
  }
  if (typeof onChange !== 'function') {
    throw new TypeError('watch: onChange must be a function');
  }
  const accept = typeof filter === 'function' ? filter : defaultFilter;
  const timerHost = { setTimeout, clearTimeout, ...timers };
  const fsWatchFn = typeof fsWatchImpl === 'function' ? fsWatchImpl : defaultFsWatch;
  /** @type {{ base: string, handle: ReturnType<typeof defaultFsWatch> | null, needsRearm: boolean }[]} */
  const baseWatchers = [];
  const pending = new Map();
  let timer = null;
  let closed = false;

  function reportError(err) {
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* swallow onError faults */ }
    }
  }

  function ensureFlushScheduled() {
    if (closed) return;
    if (timer) return;
    timer = timerHost.setTimeout(flush, debounceMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function flush() {
    timer = null;
    if (closed) return;
    const batch = Array.from(pending.entries());
    pending.clear();
    for (const [path, type] of batch) {
      try {
        onChange({ type, path });
      } catch (err) {
        reportError(err);
      }
    }
    // Issue #336: re-arm any base that saw a rename in this window.
    // Closing and reopening the fs.watch handle re-registers inotify
    // watches against current inodes, so a path that was replaced by
    // rename starts firing again. One re-arm per flush collapses a
    // burst of renames onto a single swap.
    for (const rec of baseWatchers) {
      if (!rec.needsRearm) continue;
      rec.needsRearm = false;
      if (closed) continue;
      try { rec.handle?.close(); } catch { /* swallow */ }
      rec.handle = openBaseHandle(rec.base);
    }
  }

  function schedule(path, type) {
    if (closed) return;
    pending.set(path, type);
    if (timer) timerHost.clearTimeout(timer);
    timer = timerHost.setTimeout(flush, debounceMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function markRearm(base) {
    const rec = baseWatchers.find((r) => r.base === base);
    if (!rec) return;
    rec.needsRearm = true;
    // Even if no path survived the filter, a rename event means the
    // handle may be about to go blind: make sure flush fires so the
    // re-arm actually happens.
    ensureFlushScheduled();
  }

  async function classify(fullPath, eventType) {
    if (eventType === 'change') return 'change';
    try {
      await access(fullPath, constants.F_OK);
      return 'create';
    } catch {
      return 'delete';
    }
  }

  function openBaseHandle(base) {
    let w;
    try {
      w = fsWatchFn(base, { recursive: true }, (eventType, filename) => {
        if (closed) return;
        // Issue #336: a rename anywhere under `base` can invalidate
        // the handle's descriptors for the renamed path. Mark the base
        // for re-arm regardless of whether the specific filename is
        // one we would otherwise report (filtered paths still count).
        if (eventType === 'rename') markRearm(base);
        if (!filename) return;
        const full = join(base, filename);
        if (!accept(full)) return;
        classify(full, eventType).then((type) => {
          schedule(full, type);
        }).catch(() => {
          schedule(full, 'change');
        });
      });
    } catch (err) {
      reportError(err);
      return null;
    }
    if (typeof w.on === 'function') {
      w.on('error', (err) => {
        // Silently drop ENOENT (watched path deleted mid-run); surface the rest.
        if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
        reportError(err);
      });
    }
    return w;
  }

  for (const base of paths) {
    if (typeof base !== 'string' || !isAbsolute(base)) {
      throw new TypeError(`watch: paths must be absolute, got ${String(base)}`);
    }
    const handle = openBaseHandle(base);
    if (handle) baseWatchers.push({ base, handle, needsRearm: false });
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) {
      timerHost.clearTimeout(timer);
      timer = null;
    }
    pending.clear();
    for (const rec of baseWatchers) {
      try { rec.handle?.close(); } catch { /* swallow */ }
      rec.handle = null;
    }
    baseWatchers.length = 0;
    if (signal && typeof signal.removeEventListener === 'function') {
      try { signal.removeEventListener('abort', close); } catch { /* swallow */ }
    }
  }

  if (signal) {
    if (signal.aborted) close();
    else signal.addEventListener('abort', close, { once: true });
  }

  return { close };
}

function defaultFilter(path) {
  return path.endsWith('.json');
}
