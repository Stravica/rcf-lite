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

import { watch as fsWatch } from 'node:fs';
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
 * @returns {{ close: () => void }}
 */
export function watch({
  paths,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  signal,
  onError,
  filter,
} = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError('watch: paths must be a non-empty array of absolute paths');
  }
  if (typeof onChange !== 'function') {
    throw new TypeError('watch: onChange must be a function');
  }
  const accept = typeof filter === 'function' ? filter : defaultFilter;
  const watchers = [];
  const pending = new Map();
  let timer = null;
  let closed = false;

  function reportError(err) {
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* swallow onError faults */ }
    }
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
  }

  function schedule(path, type) {
    if (closed) return;
    pending.set(path, type);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
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

  for (const base of paths) {
    if (typeof base !== 'string' || !isAbsolute(base)) {
      throw new TypeError(`watch: paths must be absolute, got ${String(base)}`);
    }
    let w;
    try {
      w = fsWatch(base, { recursive: true }, (eventType, filename) => {
        if (closed) return;
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
      continue;
    }
    w.on('error', (err) => {
      // Silently drop ENOENT (watched path deleted mid-run); surface the rest.
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
      reportError(err);
    });
    watchers.push(w);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending.clear();
    for (const w of watchers) {
      try { w.close(); } catch { /* swallow */ }
    }
    watchers.length = 0;
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
