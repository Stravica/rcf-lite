// Live-view client. Loaded by the server-rendered page as
// `<script src="/live-client.js" defer>`. Handles the SSE `/events`
// stream, in-place `innerHTML` swaps into `#rcf-live-content`, and
// persists `<details>` open-set + main scrollTop to `localStorage`
// across every swap and every full reload.
//
// Vanilla classic script (no ESM syntax) so the base HTML script tag
// stays plain. The IIFE exposes its internals as `window.__rcfLiveClient`
// so `test/view/live-client.test.js` can drive them via `node:vm` without
// jsdom.
//
// Spec: projects/rcf-build-lite/specs/phase-3.8-live-view.md D12, D13a,
// D13b, D14.

(function () {
  var STORAGE_NS = 'rcf-view:v1:';
  var STORAGE_OPEN = STORAGE_NS + 'openDetails';
  var STORAGE_SCROLL = STORAGE_NS + 'scrollTop';
  var HEARTBEAT_STALE_MS = 45000;

  // ---- state persistence ------------------------------------------------

  function safeGetItem(storage, key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }

  function safeSetItem(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function snapshotState(deps) {
    var doc = deps.document;
    var storage = deps.storage;
    if (!doc || !storage) return;
    try {
      var open = [];
      var nodes = doc.querySelectorAll('details[data-doc-id]');
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        if (el.open) open.push(el.getAttribute('data-doc-id'));
      }
      safeSetItem(storage, STORAGE_OPEN, JSON.stringify(open));
    } catch (e) { /* soft */ }
    try {
      var main = doc.querySelector('main');
      var scrollTop = 0;
      if (main && typeof main.scrollTop === 'number') scrollTop = main.scrollTop;
      else if (deps.window && typeof deps.window.scrollY === 'number') scrollTop = deps.window.scrollY;
      safeSetItem(storage, STORAGE_SCROLL, String(scrollTop));
    } catch (e) { /* soft */ }
  }

  function loadOpenSet(storage) {
    var raw = safeGetItem(storage, STORAGE_OPEN);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(function (id) { return typeof id === 'string'; });
    } catch (e) { /* soft */ }
    return [];
  }

  function cssEscape(id) {
    return String(id).replace(/["\\]/g, function (c) { return '\\' + c; });
  }

  function restoreState(deps) {
    var doc = deps.document;
    var storage = deps.storage;
    if (!doc || !storage) return { openedCount: 0, droppedIds: [], scrollTop: null };
    var wanted = loadOpenSet(storage);
    var opened = 0;
    var dropped = [];
    for (var i = 0; i < wanted.length; i += 1) {
      var id = wanted[i];
      var sel = 'details[data-doc-id="' + cssEscape(id) + '"]';
      var el = null;
      try { el = doc.querySelector(sel); } catch (e) { el = null; }
      if (el) {
        el.open = true;
        opened += 1;
      } else {
        dropped.push(id);
      }
    }
    if (dropped.length > 0) {
      // Stale-key hygiene: rewrite the persisted set with only the ids
      // that still exist. Silent - no console output for expected drift.
      var kept = wanted.filter(function (id) { return dropped.indexOf(id) === -1; });
      safeSetItem(storage, STORAGE_OPEN, JSON.stringify(kept));
    }

    var scrollTop = null;
    var raw = safeGetItem(storage, STORAGE_SCROLL);
    if (raw != null) {
      var n = Number(raw);
      if (isFinite(n)) {
        scrollTop = n;
        var main = doc.querySelector('main');
        try {
          if (main) main.scrollTop = n;
          else if (deps.window && typeof deps.window.scrollTo === 'function') deps.window.scrollTo(0, n);
        } catch (e) { /* soft */ }
      }
    }
    return { openedCount: opened, droppedIds: dropped, scrollTop: scrollTop };
  }

  // ---- connection state machine -----------------------------------------

  // Inputs: readyState of EventSource (CONNECTING=0, OPEN=1, CLOSED=2),
  // ms since last heartbeat (any type of event resets this). Output is
  // one of 'connected' | 'reconnecting' | 'disconnected'.
  function classifyConnection(state) {
    var rs = state.readyState;
    var since = state.msSinceLastEvent;
    if (rs === 2) return 'disconnected';
    if (rs === 0) return 'reconnecting';
    if (typeof since === 'number' && since > HEARTBEAT_STALE_MS) return 'reconnecting';
    return 'connected';
  }

  // ---- version de-dup ---------------------------------------------------

  function shouldApplyUpdate(currentVersion, nextVersion) {
    if (typeof nextVersion !== 'number' || !isFinite(nextVersion)) return true;
    if (currentVersion === null || currentVersion === undefined) return true;
    return nextVersion > currentVersion;
  }

  // ---- browser boot ------------------------------------------------------

  function bootBrowser(win) {
    var doc = win.document;
    var storage;
    try { storage = win.localStorage; } catch (e) { storage = null; }
    var deps = { document: doc, storage: storage || memoryStorage(), window: win };

    // Inject the connection-status dot into the header. Kept out of the
    // server-rendered HTML so the layout-regression baseline stays clean
    // (only the wrapper + script tag + raw-json data-doc-id are the
    // whitelisted deltas from Phase 3.6).
    injectConnectionDot(doc);

    // Restore prior state on initial load.
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () { restoreState(deps); });
    } else {
      restoreState(deps);
    }

    var currentVersion = null;
    var lastEventAt = Date.now();
    var connState = 'reconnecting';

    function setState(next) {
      if (next === connState) return;
      connState = next;
      updateDot(doc, next);
    }

    // Snapshot on navigate-away / hide.
    win.addEventListener('beforeunload', function () { snapshotState(deps); });
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') snapshotState(deps);
    });

    var EventSourceCtor = win.EventSource;
    if (typeof EventSourceCtor !== 'function') {
      setState('disconnected');
      return;
    }
    var source = new EventSourceCtor('/events');

    source.onopen = function () {
      lastEventAt = Date.now();
      setState('connected');
    };
    source.onerror = function () {
      // EventSource sets readyState internally. Native reconnect keeps
      // trying while readyState is CONNECTING.
      var rs = typeof source.readyState === 'number' ? source.readyState : 2;
      setState(classifyConnection({ readyState: rs, msSinceLastEvent: Date.now() - lastEventAt }));
    };

    source.addEventListener('tree-update', function (ev) {
      lastEventAt = Date.now();
      var payload;
      try { payload = JSON.parse(ev.data); } catch (e) { return; }
      if (!shouldApplyUpdate(currentVersion, payload.version)) return;
      snapshotState(deps);
      var host = doc.querySelector('#rcf-live-content');
      if (host && typeof payload.contentHtml === 'string') {
        host.innerHTML = payload.contentHtml;
      }
      currentVersion = payload.version;
      // Tab buttons live in the header (outside the swap wrapper) so
      // their click handlers survive. But the swap serves every panel
      // with the same `hidden` state Phase 3.6 renders (Overview
      // visible, others hidden), so we resync visibility with the
      // currently-selected tab and re-run Mermaid in it. Also re-run
      // Mermaid inside the selected panel because .mermaid nodes in
      // the payload have no `data-processed` yet.
      resyncTabsAfterSwap(doc, win);
      restoreState(deps);
      setState('connected');
    });

    source.addEventListener('heartbeat', function () {
      lastEventAt = Date.now();
      setState('connected');
    });

    source.addEventListener('walker-error', function (ev) {
      lastEventAt = Date.now();
      // Errors also render inline via the next tree-update; nothing
      // else to do client-side for now.
      try {
        var payload = JSON.parse(ev.data);
        if (win.rcfPage) win.rcfPage._lastWalkerErrors = payload.errors;
      } catch (e) { /* soft */ }
    });

    source.addEventListener('shutdown', function () {
      setState('disconnected');
      try { source.close(); } catch (e) { /* soft */ }
    });

    // Idle liveness check: if no event in the heartbeat-stale window,
    // demote the dot to reconnecting even if the socket has not thrown
    // an error yet.
    var pollId = win.setInterval(function () {
      var rs = typeof source.readyState === 'number' ? source.readyState : 1;
      setState(classifyConnection({ readyState: rs, msSinceLastEvent: Date.now() - lastEventAt }));
    }, 5000);
    if (pollId && typeof pollId.unref === 'function') pollId.unref();
  }

  // After an SSE innerHTML swap, the tab bar in the header still shows
  // the tab the user was on (its click handlers survived because the
  // header was not replaced) but every freshly-inserted panel has the
  // Overview-visible default from the server-rendered content. Bring
  // the panels back in line with the aria-selected button and re-run
  // Mermaid in the visible one.
  function resyncTabsAfterSwap(doc, win) {
    var TABS = ['overview', 'requirements', 'architecture', 'build'];
    var selectedBtn = doc.querySelector('[role="tab"][aria-selected="true"]');
    var selected = selectedBtn && selectedBtn.getAttribute ? selectedBtn.getAttribute('data-tab') : null;
    if (!selected || TABS.indexOf(selected) === -1) selected = 'overview';
    for (var i = 0; i < TABS.length; i += 1) {
      var name = TABS[i];
      var panel = doc.getElementById('tab-' + name);
      if (!panel) continue;
      if (name === selected) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    var visible = doc.getElementById('tab-' + selected);
    try {
      if (visible && win && win.mermaid && typeof win.mermaid.run === 'function') {
        var pending = visible.querySelectorAll('.mermaid:not([data-processed="true"])');
        if (pending.length > 0) {
          win.mermaid.run({ nodes: Array.prototype.slice.call(pending) });
        }
      }
    } catch (e) { /* soft */ }
  }

  function memoryStorage() {
    var m = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
    };
  }

  function injectConnectionDot(doc) {
    if (doc.getElementById('rcf-conn-dot')) return;
    var style = doc.createElement('style');
    style.textContent = [
      '#rcf-conn-dot {',
      '  position: fixed; top: 12px; right: 12px;',
      '  width: 10px; height: 10px; border-radius: 50%;',
      '  background: #999; opacity: 0.65; z-index: 9999;',
      '  transition: background 120ms ease-in-out;',
      '}',
      '#rcf-conn-dot.connected { background: #4c9a2a; }',
      '#rcf-conn-dot.reconnecting { background: #d68f00; }',
      '#rcf-conn-dot.disconnected { background: #b03a2e; }',
    ].join('\n');
    doc.head.appendChild(style);
    var dot = doc.createElement('span');
    dot.id = 'rcf-conn-dot';
    dot.className = 'reconnecting';
    dot.setAttribute('role', 'status');
    dot.setAttribute('aria-live', 'polite');
    dot.title = 'Connecting to view server...';
    doc.body.appendChild(dot);
  }

  function updateDot(doc, state) {
    var dot = doc.getElementById('rcf-conn-dot');
    if (!dot) return;
    dot.className = state;
    if (state === 'connected') dot.title = 'Connected - live updates on';
    else if (state === 'reconnecting') dot.title = 'Reconnecting to view server...';
    else dot.title = 'Disconnected from view server';
  }

  // ---- module exports (for node:vm tests) --------------------------------

  var api = {
    snapshotState: snapshotState,
    restoreState: restoreState,
    classifyConnection: classifyConnection,
    shouldApplyUpdate: shouldApplyUpdate,
    loadOpenSet: loadOpenSet,
    memoryStorage: memoryStorage,
    injectConnectionDot: injectConnectionDot,
    updateDot: updateDot,
    resyncTabsAfterSwap: resyncTabsAfterSwap,
    STORAGE_OPEN: STORAGE_OPEN,
    STORAGE_SCROLL: STORAGE_SCROLL,
    HEARTBEAT_STALE_MS: HEARTBEAT_STALE_MS,
    bootBrowser: bootBrowser,
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.__rcfLiveClient = api;
    try { bootBrowser(window); } catch (e) {
      // Never let a client-side boot fault break the page.
      try { window.console && window.console.error && window.console.error('[rcf-live-client]', e); } catch (_e) { /* soft */ }
    }
  } else if (typeof globalThis !== 'undefined') {
    // Non-browser context (e.g. node:vm test harness with no window/document).
    globalThis.__rcfLiveClient = api;
  }
})();
