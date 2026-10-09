// Page init script. Classic (non-module) browser script extracted from
// the former inline <script> block in html-page.js: wespa (Dex,
// 2026-10-02) pins inline scripts by CSP hash, so the viewer now
// serves this logic as a cacheable asset at ./page-init.js and the
// shell page carries no inline script at all. PR 1 (viewer UI
// refresh) also folds in the shell contract:
//   - Theme boot: read ?theme=light|dark|auto, stamp data-theme on
//     <html>. Live changes arrive via postMessage from the embedding
//     host as { type: "rcf-view-theme", theme: "light"|"dark" }; we
//     check event.origin against our own and ignore anything else.
//     The viewport media query handles theme=auto natively; explicit
//     light/dark wins over the media query.
//   - Embed boot: ?embed=1 stamps data-embed on <html>; the stylesheet
//     hides the brand block and footer in that state and keeps the
//     tab nav sticky.
//   - Router: hash scheme #tab=&sub=&entity=&... with bare #REQ-002
//     still working; every hash write preserves the host query string
//     (?embed=1, ?theme=..., ?blueprint=..., ?ticket=...) so embed and
//     theme survive every in-viewer navigation.
//
// Idempotent: live-client re-invokes rcfPage.init() after every SSE
// innerHTML swap of #rcf-live-content. All wiring guards with
// __rcfTabWired-style sentinels.

(function () {
  var TABS = ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'];
  var PM_GROUPS = ['shape', 'component', 'trace', 'capability', 'blueprint'];
  var PM_STATUSES = ['all', 'draft', 'review', 'needsRevision', 'approved', 'superseded'];
  // Partial-render cache: grouping -> HTML string. First fetch fills it,
  // subsequent switches use the cache.
  var pmPartialCache = {};
  function pmCacheKey(group) { return group; }

  // ---- shell: theme + embed ---------------------------------------------

  function parseQuery(search) {
    var out = {};
    if (typeof search !== 'string' || search.length === 0) return out;
    var raw = search.charAt(0) === '?' ? search.slice(1) : search;
    if (raw.length === 0) return out;
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i += 1) {
      var eq = pairs[i].indexOf('=');
      var k = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      var v = eq === -1 ? '' : pairs[i].slice(eq + 1);
      if (!k) continue;
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    }
    return out;
  }

  function applyTheme(t) {
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
  }

  function applyEmbed(flag) {
    var root = document.documentElement;
    if (flag) root.setAttribute('data-embed', '1');
    else root.removeAttribute('data-embed');
  }

  // Theme provenance (PR 291 landing review F1). live-client re-runs
  // rcfPage.init() after every SSE swap, so the boot theme must be
  // resolved and applied ONCE. The state lives on <html> (which
  // survives every swap and any re-evaluation of this script), like
  // the __rcf*Wired sentinels elsewhere in this file. `source` is the
  // last thing that set the theme: 'query' (?theme=), 'stored'
  // (rcf-view:v1:theme), 'default' (auto), 'host' (rcf-view-theme
  // postMessage) or 'control' (a click on the theme control). A
  // re-init never overrides 'host' or 'control'.
  function themeState() {
    var root = document.documentElement;
    if (!root.__rcfThemeState) root.__rcfThemeState = { booted: false, source: null, choice: 'auto' };
    return root.__rcfThemeState;
  }

  function setTheme(mode, source) {
    applyTheme(mode === 'auto' ? null : mode);
    var st = themeState();
    st.source = source;
    st.choice = mode;
  }

  // Three-state theme control (ADR-4137 standalone-theme-persistence,
  // Baz 2026-10-04 w-2026-10-04-dave-001). The control writes
  // `rcf-view:v1:theme` in non-embed mode only; under embed the control
  // is removed from the DOM entirely and the key is never read or
  // written. The key sits under the shared `rcf-view:v1:` namespace so
  // the PR 9 localStorage namespace lint stays green.
  var THEME_STORAGE_KEY = 'rcf-view:v1:theme';

  function isEmbedActive() {
    try { return document.documentElement.getAttribute('data-embed') === '1'; }
    catch (e) { return false; }
  }

  function safeStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      return window.localStorage;
    } catch (e) {
      // localStorage can throw on strict privacy modes; treat as absent.
      return null;
    }
  }

  function readStoredTheme() {
    // The storage boundary (ADR-4137 consequences): under embed we
    // never read the shared key, so a future re-render of the control
    // under embed cannot accidentally pick up a value either.
    if (isEmbedActive()) return null;
    var s = safeStorage();
    if (!s) return null;
    try {
      var v = s.getItem(THEME_STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
      return null;
    } catch (e) { return null; }
  }

  function writeStoredTheme(v) {
    if (isEmbedActive()) return; // never write under embed (ADR-4137)
    if (v !== 'light' && v !== 'dark' && v !== 'auto') return;
    var s = safeStorage();
    if (!s) return;
    try { s.setItem(THEME_STORAGE_KEY, v); } catch (e) { /* quota or disabled */ }
  }

  // Reflect the current effective theme choice (light|dark|auto) on
  // the control's three buttons. Idempotent across live swaps so the
  // Router re-run after an SSE innerHTML swap of `#rcf-live-content`
  // re-syncs (the control itself sits outside the swap wrapper so it
  // survives, but a fresh page-init call still re-wires guards).
  function reflectThemeChoice(mode) {
    var buttons = document.querySelectorAll('[data-rcf-theme-control] [data-rcf-theme]');
    for (var i = 0; i < buttons.length; i += 1) {
      var b = buttons[i];
      var isTarget = b.getAttribute('data-rcf-theme') === mode;
      b.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
    }
  }

  function wireThemeControl() {
    if (isEmbedActive()) {
      // ADR-4137: control is absent from the DOM entirely under embed,
      // not merely hidden by CSS. renderPage({ embed: true }) already
      // omits the markup; this strip-on-boot is the client-side layer
      // for the production path where the server renders one page for
      // every client regardless of the client's query.
      var ctl = document.querySelector('[data-rcf-theme-control]');
      if (ctl && ctl.parentNode) ctl.parentNode.removeChild(ctl);
      return;
    }
    var buttons = document.querySelectorAll('[data-rcf-theme-control] [data-rcf-theme]');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      if (btn.__rcfThemeWired) continue;
      btn.__rcfThemeWired = true;
      btn.addEventListener('click', function (ev) {
        var mode = ev.currentTarget.getAttribute('data-rcf-theme');
        if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') return;
        setTheme(mode, 'control');
        writeStoredTheme(mode);
        reflectThemeChoice(mode);
      });
    }
  }

  // Resolve the effective theme choice for boot, in the precedence
  // ADR-4137 pins: explicit ?theme= wins first; then (non-embed only)
  // the stored value; then auto. The stored value is NEVER consulted
  // under embed. Returns { mode: 'light'|'dark'|'auto', source:
  // 'query'|'stored'|'default' }.
  function resolveBootTheme(query) {
    var q = query && (query.theme === 'light' || query.theme === 'dark' || query.theme === 'auto')
      ? query.theme : null;
    if (q) return { mode: q, source: 'query' };
    var stored = readStoredTheme();
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return { mode: stored, source: 'stored' };
    return { mode: 'auto', source: 'default' };
  }

  function initShellFromQuery() {
    var q = parseQuery(window.location.search);
    // embed first so isEmbedActive() reads the right boundary when
    // the theme precedence check consults storage.
    applyEmbed(q.embed === '1');
    var st = themeState();
    var qTheme = (q.theme === 'light' || q.theme === 'dark' || q.theme === 'auto') ? q.theme : null;
    if (!st.booted) {
      // First init: resolve the boot theme in ADR-4137 precedence and
      // apply it once.
      st.booted = true;
      var boot = resolveBootTheme(q);
      setTheme(boot.mode, boot.source);
    } else if (qTheme && st.source === 'query') {
      // Re-init (SSE swap): re-assert ?theme= only while it is still
      // the last thing that set the theme. A host postMessage or a
      // control click since boot wins and is never overridden; with no
      // ?theme= a re-init applies nothing (embed host themes survive).
      setTheme(qTheme, 'query');
    }
    // Strip or wire the control after embed has been stamped; the
    // helper reads data-embed to pick the branch.
    wireThemeControl();
    reflectThemeChoice(st.choice);
  }

  var messageListenerWired = false;
  function wireThemeMessages() {
    if (messageListenerWired) return;
    messageListenerWired = true;
    window.addEventListener('message', function (ev) {
      // Same-origin only: wespa reverse-proxies the viewer under its
      // own origin, so a legitimate theme ping comes from the viewer's
      // own origin. Anything else is a cross-origin posting we ignore.
      if (!ev || ev.origin !== window.location.origin) return;
      var data = ev.data || {};
      if (data.type !== 'rcf-view-theme') return;
      if (data.theme === 'light' || data.theme === 'dark') {
        setTheme(data.theme, 'host');
        // Live postMessage never writes the stored key (ADR-4137):
        // the host-driven swap is a session-only override.
        reflectThemeChoice(data.theme);
      }
    });
  }

  // ---- hash parsing + preservation --------------------------------------

  function flashLookupTarget(el) {
    if (!el || !el.classList) return;
    try {
      el.classList.remove('is-rcf-lookup-flash');
      // Force reflow so the animation restarts on repeat picks.
      void el.offsetWidth;
      el.classList.add('is-rcf-lookup-flash');
      setTimeout(function () { try { el.classList.remove('is-rcf-lookup-flash'); } catch (e) {} }, 1400);
    } catch (e) {}
  }

  function parseHashParams(raw) {
    var out = {};
    if (!raw) return out;
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf('=');
      if (eq === -1) continue;
      var k = parts[i].slice(0, eq);
      var v = parts[i].slice(eq + 1);
      if (k) out[k] = v;
    }
    return out;
  }

  // Build a URL that keeps the host query untouched (?embed=, ?theme=,
  // ?blueprint=, ?ticket=, ...) and only swaps the hash. Required by
  // Dex's embed contract: embed/theme survive every in-viewer navigation.
  function urlWithHash(hash) {
    var base = window.location.pathname + window.location.search;
    if (!hash) return base;
    return base + (hash.charAt(0) === '#' ? hash : '#' + hash);
  }

  function writeHash(hash, replace) {
    if (!window.history) return;
    var fn = replace === false ? 'pushState' : 'replaceState';
    if (typeof window.history[fn] !== 'function') return;
    var next = urlWithHash(hash);
    if (next === window.location.pathname + window.location.search + window.location.hash) return;
    window.history[fn](null, '', next);
  }

  // ---- mermaid lifecycle ------------------------------------------------

  function initMermaid() {
    if (typeof window.mermaid !== 'undefined') {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    }
  }

  function runMermaidIn(container) {
    if (!container || typeof window.mermaid === 'undefined') return;
    var pending = container.querySelectorAll('.mermaid:not([data-processed="true"])');
    if (pending.length === 0) return;
    try {
      window.mermaid.run({ nodes: Array.prototype.slice.call(pending) });
    } catch (e) { /* swallow */ }
  }

  // ---- tabs -------------------------------------------------------------

  function tabButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('nav.tabs [role="tab"]'));
  }

  function panelFor(name) {
    return document.getElementById('tab-' + name);
  }

  function activateTab(name) {
    if (TABS.indexOf(name) === -1) return false;
    tabButtons().forEach(function (btn) {
      var isTarget = btn.getAttribute('data-tab') === name;
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    TABS.forEach(function (t) {
      var p = panelFor(t);
      if (!p) return;
      if (t === name) {
        p.removeAttribute('hidden');
        runMermaidIn(p);
      } else {
        p.setAttribute('hidden', '');
      }
    });
    return true;
  }

  function tabForNode(node) {
    var cur = node;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute('role') === 'tabpanel') {
        var id = cur.id || '';
        if (id.indexOf('tab-') === 0) return id.slice(4);
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function openAncestorDetails(node) {
    var cur = node.parentNode;
    while (cur && cur !== document.body) {
      if (cur.tagName && cur.tagName.toLowerCase() === 'details') {
        cur.open = true;
      }
      cur = cur.parentNode;
    }
  }

  function findByDocId(id) {
    if (!id) return null;
    var byId = document.getElementById(id);
    if (byId) return byId;
    return document.querySelector('[data-doc-id="' + id.replace(/"/g, '\\\\"') + '"]');
  }

  // FBS-204 (TAC-4135, AC-18003-2): the Readiness command page carries
  // rows whose itemId is not a document id (brief:ledger,
  // profile:surface, open-decision:5). findByDocId cannot resolve
  // these; findByReadinessEntity reads the row's [data-rcf-entity]
  // attribute which the tables renderer stamps on every row. Called
  // from the hash router when #tab=readiness carries an &entity= whose
  // value does not land on a doc.
  function findByReadinessEntity(itemId) {
    if (!itemId) return null;
    try {
      return document.querySelector('[data-rcf-entity="' + String(itemId).replace(/"/g, '\\"') + '"]');
    } catch (e) { return null; }
  }

  // ---- product map ------------------------------------------------------

  function pmGroupPanel(name) {
    return document.getElementById('pm-group-' + name);
  }

  function hydrateLazyGroup(name, cb) {
    var panel = pmGroupPanel(name);
    if (!panel) { if (cb) cb(false); return; }
    if (panel.getAttribute('data-pm-lazy') !== 'true' && !pmPartialCache[pmCacheKey(name)]) {
      if (cb) cb(true);
      return;
    }
    if (window.__rcfPmDirty) {
      pmPartialCache = {};
      window.__rcfPmDirty = false;
    }
    var cached = pmPartialCache[pmCacheKey(name)];
    var heading = panel.querySelector('.pm-group-heading');
    var headingHtml = heading ? heading.outerHTML : '';
    if (cached) {
      panel.innerHTML = headingHtml + cached;
      panel.removeAttribute('data-pm-lazy');
      wireProductMapWithin(panel);
      if (cb) cb(true);
      return;
    }
    panel.setAttribute('data-pm-loading', 'true');
    var xhr = new XMLHttpRequest();
    // Dex / wespa 2026-10-02: asset references are relative so the
    // reverse-proxy mount point can live anywhere under its origin.
    xhr.open('GET', './product-map/' + name, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      panel.removeAttribute('data-pm-loading');
      if (xhr.status >= 200 && xhr.status < 300) {
        pmPartialCache[pmCacheKey(name)] = xhr.responseText;
        panel.innerHTML = headingHtml + xhr.responseText;
        panel.removeAttribute('data-pm-lazy');
        wireProductMapWithin(panel);
        if (cb) cb(true);
      } else {
        panel.setAttribute('data-pm-lazy', 'true');
        if (cb) cb(false);
      }
    };
    xhr.send();
  }

  function activatePmGroup(name, opts) {
    if (PM_GROUPS.indexOf(name) === -1) return false;
    var buttons = document.querySelectorAll('.pm-group-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var isTarget = btn.getAttribute('data-pm-group') === name;
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    }
    var panels = document.querySelectorAll('.pm-group');
    for (var j = 0; j < panels.length; j += 1) {
      var p = panels[j];
      if (p.getAttribute('data-pm-group') === name) {
        p.removeAttribute('hidden');
      } else {
        p.setAttribute('hidden', '');
      }
    }
    var target = pmGroupPanel(name);
    if (target && target.getAttribute('data-pm-lazy') === 'true') {
      hydrateLazyGroup(name, function () {
        if (opts && opts.after) opts.after();
        applyPmStatusFilter(currentStatus());
      });
    } else {
      if (opts && opts.after) opts.after();
      applyPmStatusFilter(currentStatus());
    }
    return true;
  }

  function currentGroup() {
    var sel = document.querySelector('.pm-group-btn[aria-selected="true"]');
    return sel ? sel.getAttribute('data-pm-group') : 'shape';
  }

  function currentStatus() {
    var s = document.querySelector('.pm-status-select');
    return s ? s.value : 'all';
  }

  function currentOpenBuckets() {
    var group = currentGroup();
    var panel = pmGroupPanel(group);
    if (!panel) return [];
    var nodes = panel.querySelectorAll('details.pm-bucket[open]');
    var out = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var id = nodes[i].getAttribute('data-pm-bucket-id');
      if (id) out.push(id);
    }
    return out;
  }

  function applyPmStatusFilter(status) {
    if (PM_STATUSES.indexOf(status) === -1) return false;
    var select = document.querySelector('.pm-status-select');
    if (select) select.value = status;
    var reqCards = document.querySelectorAll('#tab-product-map [data-req-status]');
    for (var i = 0; i < reqCards.length; i += 1) {
      var card = reqCards[i];
      var s = card.getAttribute('data-req-status') || '';
      if (status === 'all' || s === status) {
        card.removeAttribute('hidden');
      } else {
        card.setAttribute('hidden', '');
      }
    }
    var buckets = document.querySelectorAll('#tab-product-map .pm-group:not([hidden]) details.pm-bucket');
    var emptyCount = 0;
    for (var k = 0; k < buckets.length; k += 1) {
      var bk = buckets[k];
      var visible = bk.querySelectorAll('[data-req-status]:not([hidden])');
      var bodyEmpty = bk.querySelector('.pm-bucket-body') && bk.querySelector('.pm-bucket-body').children.length === 0;
      var isEmpty = visible.length === 0 && !bodyEmpty;
      var body = bk.querySelector('.pm-bucket-body');
      var emptyNote = body ? body.querySelector('.pm-bucket-empty-filter') : null;
      if (isEmpty && status !== 'all') {
        if (body && !emptyNote) {
          emptyNote = document.createElement('p');
          emptyNote.className = 'pm-bucket-empty pm-bucket-empty-filter';
          emptyNote.innerHTML = '<em>0 requirements match this filter.</em>';
          body.appendChild(emptyNote);
        }
        bk.setAttribute('data-pm-empty-under-filter', 'true');
        emptyCount += 1;
      } else {
        if (emptyNote) emptyNote.parentNode.removeChild(emptyNote);
        bk.removeAttribute('data-pm-empty-under-filter');
      }
    }
    var activePanel = document.querySelector('#tab-product-map .pm-group:not([hidden])');
    if (activePanel) {
      var roll = activePanel.querySelector('.pm-empty-roll');
      if (roll) {
        var showBtn = roll.querySelector('.pm-empty-count');
        if (emptyCount > 0 && status !== 'all') {
          if (showBtn) showBtn.textContent = String(emptyCount);
          roll.removeAttribute('hidden');
          activePanel.classList.add('pm-hide-empty');
        } else {
          roll.setAttribute('hidden', '');
          activePanel.classList.remove('pm-hide-empty');
        }
      }
    }
    return true;
  }

  function updatePmHash() {
    if (!window.history || typeof window.history.pushState !== 'function') return;
    var group = currentGroup();
    var status = currentStatus();
    var open = currentOpenBuckets();
    var next = '#tab=product-map&group=' + group + '&status=' + status;
    if (open.length > 0) next += '&open=' + encodeURIComponent(open.join(','));
    if (window.location.hash === next && window.location.search === window.location.search) return;
    // Preserve host query (?embed=, ?theme=, ?blueprint=, ?ticket=).
    window.history.pushState(null, '', urlWithHash(next));
  }

  function openPmBuckets(ids) {
    if (!ids || ids.length === 0) return;
    var group = currentGroup();
    var panel = pmGroupPanel(group);
    if (!panel) return;
    for (var i = 0; i < ids.length; i += 1) {
      var raw = ids[i];
      if (!raw) continue;
      var node = panel.querySelector('details.pm-bucket[data-pm-bucket-id="' + raw.replace(/"/g, '\\"') + '"]');
      if (node) node.open = true;
    }
  }

  function wireProductMapWithin(root) {
    root = root || document;
    var buckets = root.querySelectorAll('details.pm-bucket');
    for (var i = 0; i < buckets.length; i += 1) {
      var bk = buckets[i];
      if (bk.__rcfPmBucketWired) continue;
      bk.__rcfPmBucketWired = true;
      bk.addEventListener('toggle', function () {
        if (window.__rcfPmSuppress) return;
        updatePmHash();
      });
    }
    var chips = root.querySelectorAll('.pm-jump-chip');
    for (var j = 0; j < chips.length; j += 1) {
      var chip = chips[j];
      if (chip.__rcfPmChipWired) continue;
      chip.__rcfPmChipWired = true;
      chip.addEventListener('click', function (ev) {
        var target = ev.currentTarget.getAttribute('data-pm-jump');
        var groupAttr = ev.currentTarget.closest('.pm-jump-nav').getAttribute('data-pm-jump-group');
        var panel = pmGroupPanel(groupAttr);
        if (!panel) return;
        var node = panel.querySelector('details.pm-bucket[data-pm-bucket-id="' + target.replace(/"/g, '\\"') + '"]');
        if (!node) return;
        node.open = true;
        try { node.scrollIntoView({ block: 'start' }); } catch (e) { node.scrollIntoView(); }
      });
    }
    var bulk = root.querySelectorAll('.pm-bulk-btn');
    for (var b = 0; b < bulk.length; b += 1) {
      var btn = bulk[b];
      if (btn.__rcfPmBulkWired) continue;
      btn.__rcfPmBulkWired = true;
      btn.addEventListener('click', function (ev) {
        var action = ev.currentTarget.getAttribute('data-pm-bulk');
        var panel = document.querySelector('#tab-product-map .pm-group:not([hidden])');
        if (!panel) return;
        var all = panel.querySelectorAll('details.pm-bucket');
        window.__rcfPmSuppress = true;
        for (var i = 0; i < all.length; i += 1) all[i].open = (action === 'expand');
        window.__rcfPmSuppress = false;
        updatePmHash();
      });
    }
    var rolls = root.querySelectorAll('.pm-empty-toggle');
    for (var r = 0; r < rolls.length; r += 1) {
      var rt = rolls[r];
      if (rt.__rcfPmEmptyWired) continue;
      rt.__rcfPmEmptyWired = true;
      rt.addEventListener('click', function (ev) {
        var panel = ev.currentTarget.closest('.pm-group');
        if (!panel) return;
        if (panel.classList.contains('pm-hide-empty')) {
          panel.classList.remove('pm-hide-empty');
          ev.currentTarget.textContent = 'Hide empty buckets';
        } else {
          panel.classList.add('pm-hide-empty');
          var span = document.createElement('span');
          span.className = 'pm-empty-count';
          span.textContent = String(panel.querySelectorAll('details.pm-bucket[data-pm-empty-under-filter="true"]').length);
          ev.currentTarget.textContent = '';
          ev.currentTarget.appendChild(document.createTextNode('Show '));
          ev.currentTarget.appendChild(span);
          ev.currentTarget.appendChild(document.createTextNode(' empty buckets'));
        }
      });
    }
  }

  function wireProductMap() {
    var buttons = document.querySelectorAll('.pm-group-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].__rcfPmWired) continue;
      buttons[i].__rcfPmWired = true;
      buttons[i].addEventListener('click', function (ev) {
        var name = ev.currentTarget.getAttribute('data-pm-group');
        if (activatePmGroup(name)) updatePmHash();
      });
    }
    var select = document.querySelector('.pm-status-select');
    if (select && !select.__rcfPmWired) {
      select.__rcfPmWired = true;
      select.addEventListener('change', function () {
        applyPmStatusFilter(select.value);
        updatePmHash();
      });
    }
    wireProductMapWithin(document);
  }

  // ---- hash router ------------------------------------------------------
  //
  // PR 1 contract: #tab=<name>&sub=<name>&entity=<id>&... with bare
  // #REQ-002 still resolving. Unknown params survive. Writes go through
  // urlWithHash so the ?embed=/?theme= query is preserved. 'sub=' is
  // owned by the active tab (Build tab in PR 5 for specs|dag); for PR 1
  // we only read the value and leave acting on it to a later tab-side
  // handler.

  function resolveHash(hash) {
    if (!hash) { activateTab('readiness'); return; }
    var raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    // Decision 11 (PR 3): `#entity=<id>` without a tab key still
    // resolves - we find the target, activate its tab and open ancestors.
    if (raw.indexOf('=') !== -1 && raw.indexOf('tab=') === -1) {
      var kv = parseHashParams(raw);
      if (kv.entity) {
        var entTarget = findByDocId(kv.entity) || findByReadinessEntity(kv.entity);
        if (entTarget) {
          var entTab = tabForNode(entTarget);
          if (entTab) activateTab(entTab);
          openAncestorDetails(entTarget);
          if (entTarget.tagName && entTarget.tagName.toLowerCase() === 'details') entTarget.open = true;
          try { entTarget.scrollIntoView({ block: 'start' }); } catch (e) { entTarget.scrollIntoView(); }
          return;
        }
      }
    }
    if (raw.indexOf('tab=') === 0 || raw.indexOf('tab=') > 0) {
      // Fast path: tab is the first key.
      var params = parseHashParams(raw);
      var tab = params.tab;
      if (tab && TABS.indexOf(tab) !== -1) {
        activateTab(tab);
        if (tab === 'product-map') {
          var openIds = params.open ? decodeURIComponent(params.open).split(',').filter(Boolean) : [];
          activatePmGroup(params.group || 'shape', {
            after: function () {
              if (params.status) applyPmStatusFilter(params.status);
              openPmBuckets(openIds);
            },
          });
        }
        // Requirements tab: push the hash filter slots into the
        // FilterBar inputs and re-run the row filter so the first paint
        // reflects the URL exactly. #entity=... below opens the entity.
        if (tab === 'requirements' && requirementsFilterBar()) {
          applyRequirementsHash(params);
        }
        // Architecture tab: push the two FilterBar states + any
        // `open=<tad-section>,<tad-section>...` deep-link so the first
        // paint reflects the URL (PR 4, decisions 3 and 5).
        if (tab === 'architecture' && (archBar('architecture-components') || archBar('architecture-decisions'))) {
          applyArchitectureHash(params);
        }
        // Build tab (PR 5): activate the right sub-tab and push the
        // Specs FilterBar state so the first paint reflects the URL.
        if (tab === 'build') {
          applyBuildHash(params);
        }
        // Readiness tab (FBS-206, AC-18005-2 and -8): activate the right
        // sub-tab, drop an unknown sub= from the hash, and apply any
        // blocking FilterBar params the Overview verdict grid links
        // carry (stage=, persona=).
        if (tab === 'readiness' && readinessSubTabStrip()) {
          applyReadinessHash(params);
        }
        // #tab=requirements&entity=REQ-002 opens the entity in place.
        // FBS-204 (AC-18003-2): #tab=readiness&sub=questions&entity=<itemId>
        // lands on a readiness-row element when the itemId is not a
        // document (brief:ledger, profile:surface, open-decision:5).
        if (params.entity) {
          var ent = findByDocId(params.entity);
          if (!ent && tab === 'readiness') ent = findByReadinessEntity(params.entity);
          if (ent) {
            // FBS-204 (AC-18003-1): "opens the item in full context".
            // When the entity resolves to a document that lives on a
            // different tab from the one in the hash (for example
            // #tab=readiness&sub=questions&entity=REQ-012 and REQ-012
            // sits in the Requirements tab), switch to that tab so the
            // target becomes visible rather than opening hidden.
            var entTabName = tabForNode(ent);
            if (entTabName && entTabName !== tab && TABS.indexOf(entTabName) !== -1) {
              activateTab(entTabName);
            }
            openAncestorDetails(ent);
            if (ent.tagName && ent.tagName.toLowerCase() === 'details') ent.open = true;
            try { ent.scrollIntoView({ block: 'start' }); } catch (e) { ent.scrollIntoView(); }
            flashLookupTarget(ent);
          }
        }
        return;
      }
    }
    // Bare hash (#REQ-002 etc) stays supported.
    var target = findByDocId(raw);
    if (!target) { activateTab('readiness'); return; }
    var tabName = tabForNode(target);
    if (tabName) activateTab(tabName);
    openAncestorDetails(target);
    if (target.tagName && target.tagName.toLowerCase() === 'details') target.open = true;
    try { target.scrollIntoView({ block: 'start' }); } catch (e) { target.scrollIntoView(); }
    flashLookupTarget(target);
  }

  function onTabClick(ev) {
    var btn = ev.currentTarget;
    var name = btn.getAttribute('data-tab');
    if (!name) return;
    ev.preventDefault && ev.preventDefault();
    activateTab(name);
    if (name === 'product-map') {
      activatePmGroup(currentGroup());
    }
    // The Build tab carries a SubTabStrip + FilterBar state the URL
    // mirrors; re-emit the current fragment so #tab=build / UI stay in
    // step (fixes the DAG-sticky case: previously `#tab=build` was
    // written while DAG remained visible).
    if (name === 'build' && buildSubTabStrip()) {
      writeHash(buildHashFragment(), true);
      return;
    }
    // Readiness tab (FBS-206): mirror the sub-tab state into the hash
    // so a tab click from elsewhere lands on the current sub.
    if (name === 'readiness' && readinessSubTabStrip()) {
      writeHash(readinessHashFragment(), true);
      return;
    }
    // Hash write preserves ?embed=/?theme=/... (Dex contract, PR 1).
    writeHash('#tab=' + name, true);
  }

  function wireTabs() {
    tabButtons().forEach(function (btn) {
      if (btn.__rcfTabWired) return;
      btn.__rcfTabWired = true;
      btn.addEventListener('click', onTabClick);
    });
  }

  // ---- shared toast helper (viewer UI refresh PR 2) --------------------
  //
  // The shell renders exactly one <div class="rcf-toast" data-toast> and
  // keeps it outside #rcf-live-content so the SSE innerHTML swap does
  // not blow it away. showToast() is idempotent across repeat calls:
  // the latest message replaces whatever is showing, the fade-out
  // timer resets, and the element clears when the fade completes.
  var toastHideTimer = null;
  function showToast(message, opts) {
    var el = document.querySelector('[data-toast]');
    if (!el) return;
    var text = message == null ? '' : String(message);
    el.textContent = text;
    el.classList.add('show');
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
    var durationMs = opts && typeof opts.durationMs === 'number' ? opts.durationMs : 2200;
    toastHideTimer = setTimeout(function () {
      el.classList.remove('show');
      // Clear the text one fade-out later so a reader does not re-announce it.
      toastHideTimer = setTimeout(function () {
        if (!el.classList.contains('show')) el.textContent = '';
      }, 200);
    }, durationMs);
  }

  // ---- component fixture page wiring (viewer UI refresh PR 2) ----------
  //
  // The /_fixtures/components page carries a theme toggle and a demo
  // button that fires showToast() so a reviewer can confirm the Toast
  // round-trips end-to-end. Both guards against null elements so the
  // helpers no-op on every other page.
  function wireFixturePage() {
    var themeBtns = document.querySelectorAll('[data-rcf-fixture-theme]');
    for (var i = 0; i < themeBtns.length; i += 1) {
      var btn = themeBtns[i];
      if (btn.__rcfFixtureThemeWired) continue;
      btn.__rcfFixtureThemeWired = true;
      btn.addEventListener('click', function (ev) {
        var mode = ev.currentTarget.getAttribute('data-rcf-fixture-theme');
        setTheme(mode === 'light' || mode === 'dark' ? mode : 'auto', 'control');
        var buttons = document.querySelectorAll('[data-rcf-fixture-theme]');
        for (var j = 0; j < buttons.length; j += 1) {
          var b = buttons[j];
          var isTarget = b.getAttribute('data-rcf-fixture-theme') === mode;
          b.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
        }
      });
    }
    var toastBtns = document.querySelectorAll('[data-rcf-fixture-toast]');
    for (var k = 0; k < toastBtns.length; k += 1) {
      var tb = toastBtns[k];
      if (tb.__rcfFixtureToastWired) continue;
      tb.__rcfFixtureToastWired = true;
      tb.addEventListener('click', function () {
        showToast('Saved. (demo of the shared Toast helper)');
      });
    }
  }

  // ---- Requirements FilterBar + EntitySelector (viewer UI refresh PR 3) --
  //
  // The Requirements tab mounts a FilterBar (text, area, priority, status,
  // Needs-work) and the PRD tab mounts an EntitySelector (type-ahead jump
  // + area chips). Filter state lives in the hash so a filtered view is a
  // link (decision 3). The hash slots this reads/writes:
  //   #tab=requirements[&q=...][&domain=...][&priority=...][&status=...][&needswork=1]
  // Area chips in the PRD selector write #tab=requirements&domain=...;
  // the type-ahead jump writes #tab=requirements&entity=<id>.

  function requirementsListNode() {
    return document.querySelector('[data-rcf-list="requirements"]');
  }

  function requirementsFilterBar() {
    return document.querySelector('[data-rcf-filterbar="requirements"]');
  }

  function readRequirementsFilterState() {
    var bar = requirementsFilterBar();
    if (!bar) return null;
    var text = bar.querySelector('.rcf-filter-text');
    var state = { q: text ? text.value.trim() : '', needswork: false };
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      state[selects[i].getAttribute('data-filter-key') || 'select'] = selects[i].value;
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      state[toggles[j].getAttribute('data-filter-key') || 'toggle'] = toggles[j].checked;
    }
    return state;
  }

  function writeRequirementsFilterState(state) {
    var bar = requirementsFilterBar();
    if (!bar) return;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) text.value = state.q || '';
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      var key = selects[i].getAttribute('data-filter-key') || '';
      selects[i].value = state[key] != null ? String(state[key]) : '';
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      var tkey = toggles[j].getAttribute('data-filter-key') || '';
      toggles[j].checked = state[tkey] === true || state[tkey] === 'true' || state[tkey] === '1';
    }
  }

  function applyRequirementsFilter() {
    var list = requirementsListNode();
    if (!list) return;
    var state = readRequirementsFilterState() || { q: '', domain: '', priority: '', status: '', needswork: false };
    var qLower = (state.q || '').toLowerCase();
    var rows = list.querySelectorAll(':scope > details.rcf-row[data-doc-id^="REQ-"]');
    var visible = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var hide = false;
      if (state.domain && row.getAttribute('data-domain') !== state.domain) hide = true;
      if (!hide && state.priority && row.getAttribute('data-priority') !== state.priority) hide = true;
      if (!hide && state.status && row.getAttribute('data-status') !== state.status) hide = true;
      if (!hide && state.needswork && row.getAttribute('data-needswork') !== '1') hide = true;
      if (!hide && qLower) {
        var hay = row.getAttribute('data-text') || '';
        if (hay.indexOf(qLower) === -1) hide = true;
      }
      if (hide) row.setAttribute('hidden', '');
      else { row.removeAttribute('hidden'); visible += 1; }
    }
    var countEl = document.querySelector('[data-rcf-filterbar="requirements"] .rcf-filter-count');
    if (countEl) countEl.textContent = String(visible) + ' of ' + String(rows.length) + ' visible';
  }

  function requirementsHashFragment(state) {
    var parts = ['tab=requirements'];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.domain) parts.push('domain=' + encodeURIComponent(state.domain));
    if (state.priority) parts.push('priority=' + encodeURIComponent(state.priority));
    if (state.status) parts.push('status=' + encodeURIComponent(state.status));
    if (state.needswork) parts.push('needswork=1');
    if (state.entity) parts.push('entity=' + encodeURIComponent(state.entity));
    // Decision 11: preserve unknown hash params through filter writes.
    if (state.extraParts) parts = parts.concat(state.extraParts);
    return '#' + parts.join('&');
  }

  function currentRequirementsHashExtras() {
    // Read the live hash, keep every param not owned by the Requirements
    // FilterBar so filter writes preserve the selected entity and any
    // other extension (decision 11 preservation contract).
    var raw = window.location.hash || '';
    if (raw[0] === '#') raw = raw.slice(1);
    if (!raw) return { entity: '', extraParts: [] };
    var pairs = raw.split('&');
    var entity = '';
    var extras = [];
    var owned = { tab: true, q: true, domain: true, priority: true, status: true, needswork: true, entity: true };
    for (var i = 0; i < pairs.length; i += 1) {
      var p = pairs[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var k = eq === -1 ? p : p.slice(0, eq);
      if (k === 'entity' && eq !== -1) { entity = decodeURIComponent(p.slice(eq + 1)); continue; }
      if (owned[k]) continue;
      extras.push(p);
    }
    return { entity: entity, extraParts: extras };
  }

  function writeRequirementsHash() {
    var state = readRequirementsFilterState();
    if (!state) return;
    var extras = currentRequirementsHashExtras();
    state.entity = extras.entity;
    state.extraParts = extras.extraParts;
    writeHash(requirementsHashFragment(state), true);
  }

  function applyRequirementsHash(params) {
    var state = {
      q: params.q ? decodeURIComponent(params.q) : '',
      domain: params.domain ? decodeURIComponent(params.domain) : '',
      priority: params.priority ? decodeURIComponent(params.priority) : '',
      status: params.status ? decodeURIComponent(params.status) : '',
      needswork: params.needswork === '1' || params.needswork === 'true',
    };
    writeRequirementsFilterState(state);
    applyRequirementsFilter();
  }

  function expandAllRequirements(open) {
    var list = requirementsListNode();
    if (!list) return;
    var rows = list.querySelectorAll(':scope > details.rcf-row');
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].hasAttribute('hidden')) continue;
      rows[i].open = !!open;
    }
    var btn = document.querySelector('[data-rcf-filterbar="requirements"] .rcf-filter-expand');
    if (btn) {
      btn.textContent = open ? 'Collapse all' : 'Expand all';
      btn.setAttribute('data-expand-state', open ? 'expanded' : 'collapsed');
    }
  }

  function wireRequirementsFilterBar() {
    var bar = requirementsFilterBar();
    if (!bar || bar.__rcfReqFilterWired) return;
    bar.__rcfReqFilterWired = true;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) {
      var debounceTimer = null;
      text.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          applyRequirementsFilter();
          writeRequirementsHash();
        }, 150);
      });
    }
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      selects[i].addEventListener('change', function () {
        applyRequirementsFilter();
        writeRequirementsHash();
      });
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      toggles[j].addEventListener('change', function () {
        applyRequirementsFilter();
        writeRequirementsHash();
      });
    }
    var expandBtn = bar.querySelector('.rcf-filter-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var isCollapsed = expandBtn.getAttribute('data-expand-state') !== 'expanded';
        expandAllRequirements(isCollapsed);
      });
    }
  }

  // ---- Architecture FilterBars (viewer UI refresh PR 4) ----------------
  //
  // The Architecture tab mounts two FilterBars: Components
  // (architecture-components) and Decisions (architecture-decisions).
  // Each is text + Status facet; state lives in the hash under the
  // owning tab so the view is a link. Hash slots this reads/writes:
  //   #tab=architecture[&cq=...][&cstatus=...][&dq=...][&dstatus=...]
  //     [&open=components|decisions|<tad-section-key>]
  // The `open=` key is a comma-separated set so a review link can
  // deep-open one TAD section (e.g. open=integrationArchitecture).

  var ARCH_HASH_KEYS = {
    'architecture-components': { q: 'cq', status: 'cstatus' },
    'architecture-decisions': { q: 'dq', status: 'dstatus' },
  };

  function archBar(hashKey) {
    return document.querySelector('[data-rcf-filterbar="' + hashKey + '"]');
  }

  function archList(hashKey) {
    return document.querySelector('[data-rcf-list="' + hashKey + '"]');
  }

  function readArchitectureFilterState(hashKey) {
    var bar = archBar(hashKey);
    if (!bar) return null;
    var text = bar.querySelector('.rcf-filter-text');
    var state = { q: text ? text.value.trim() : '' };
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      state[selects[i].getAttribute('data-filter-key') || 'select'] = selects[i].value;
    }
    return state;
  }

  function writeArchitectureFilterState(hashKey, state) {
    var bar = archBar(hashKey);
    if (!bar) return;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) text.value = state.q || '';
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      var key = selects[i].getAttribute('data-filter-key') || '';
      selects[i].value = state[key] != null ? String(state[key]) : '';
    }
  }

  function applyArchitectureFilter(hashKey) {
    var list = archList(hashKey);
    if (!list) return;
    var state = readArchitectureFilterState(hashKey) || { q: '', status: '' };
    var qLower = (state.q || '').toLowerCase();
    var rows = list.querySelectorAll(':scope > details.rcf-row');
    var visible = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var hide = false;
      if (state.status && row.getAttribute('data-status') !== state.status) hide = true;
      if (!hide && qLower) {
        var hay = row.getAttribute('data-text') || '';
        if (hay.indexOf(qLower) === -1) hide = true;
      }
      if (hide) row.setAttribute('hidden', '');
      else { row.removeAttribute('hidden'); visible += 1; }
    }
    var countEl = document.querySelector('[data-rcf-filterbar="' + hashKey + '"] .rcf-filter-count');
    if (countEl) countEl.textContent = String(visible) + ' of ' + String(rows.length) + ' visible';
  }

  function architectureHashFragment() {
    var parts = ['tab=architecture'];
    for (var hk in ARCH_HASH_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(ARCH_HASH_KEYS, hk)) continue;
      var state = readArchitectureFilterState(hk);
      var map = ARCH_HASH_KEYS[hk];
      if (!state) continue;
      if (state.q) parts.push(map.q + '=' + encodeURIComponent(state.q));
      if (state.status) parts.push(map.status + '=' + encodeURIComponent(state.status));
    }
    return '#' + parts.join('&');
  }

  function writeArchitectureHash() {
    writeHash(architectureHashFragment(), true);
  }

  function applyArchitectureHash(params) {
    var statesByBar = {
      'architecture-components': {
        q: params.cq ? decodeURIComponent(params.cq) : '',
        status: params.cstatus ? decodeURIComponent(params.cstatus) : '',
      },
      'architecture-decisions': {
        q: params.dq ? decodeURIComponent(params.dq) : '',
        status: params.dstatus ? decodeURIComponent(params.dstatus) : '',
      },
    };
    for (var hk in statesByBar) {
      if (!Object.prototype.hasOwnProperty.call(statesByBar, hk)) continue;
      writeArchitectureFilterState(hk, statesByBar[hk]);
      applyArchitectureFilter(hk);
    }
    if (params.open) {
      var openSet = decodeURIComponent(params.open).split(',').filter(Boolean);
      openArchitectureSections(openSet);
    }
  }

  function openArchitectureSections(keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var el = document.querySelector('[data-rcf-tad-section="' + keys[i] + '"]');
      if (el && el.tagName && el.tagName.toLowerCase() === 'details') el.open = true;
    }
  }

  function expandAllArchitecture(hashKey, open) {
    var list = archList(hashKey);
    if (!list) return;
    var rows = list.querySelectorAll(':scope > details.rcf-row');
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].hasAttribute('hidden')) continue;
      rows[i].open = !!open;
    }
    var btn = document.querySelector('[data-rcf-filterbar="' + hashKey + '"] .rcf-filter-expand');
    if (btn) {
      btn.textContent = open ? 'Collapse all' : 'Expand all';
      btn.setAttribute('data-expand-state', open ? 'expanded' : 'collapsed');
    }
  }

  function wireArchitectureFilterBar(hashKey) {
    var bar = archBar(hashKey);
    if (!bar || bar.__rcfArchFilterWired) return;
    bar.__rcfArchFilterWired = true;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) {
      var debounceTimer = null;
      text.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          applyArchitectureFilter(hashKey);
          writeArchitectureHash();
        }, 150);
      });
    }
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      selects[i].addEventListener('change', function () {
        applyArchitectureFilter(hashKey);
        writeArchitectureHash();
      });
    }
    var expandBtn = bar.querySelector('.rcf-filter-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var isCollapsed = expandBtn.getAttribute('data-expand-state') !== 'expanded';
        expandAllArchitecture(hashKey, isCollapsed);
      });
    }
  }

  function wireArchitectureFilterBars() {
    wireArchitectureFilterBar('architecture-components');
    wireArchitectureFilterBar('architecture-decisions');
  }

  // ---- Build tab (viewer UI refresh PR 5) ------------------------------
  //
  // The Build tab carries a SubTabStrip (Specs | DAG; DAG is a PR 6
  // placeholder) and the Specs sub-tab mounts a FilterBar
  // (text, status, area, size, Buildable-now). Filter + sub-tab state
  // live in the hash so a filtered view is a link. Hash slots read /
  // written here:
  //   #tab=build[&sub=specs|dag][&q=...][&status=...][&domain=...][&size=...][&buildable=1]

  var BUILD_SUB = ['specs', 'dag'];

  function buildBar() {
    return document.querySelector('[data-rcf-filterbar="build-specs"]');
  }

  function buildListNode() {
    return document.querySelector('[data-rcf-list="build-specs"]');
  }

  function buildSubTabStrip() {
    return document.querySelector('[data-rcf-subtabstrip="build"]');
  }

  function buildSubPanel(sub) {
    return document.querySelector('[data-rcf-subpanel="' + sub + '"]');
  }

  function activateBuildSub(sub) {
    if (BUILD_SUB.indexOf(sub) === -1) sub = 'specs';
    var strip = buildSubTabStrip();
    if (strip) {
      var btns = strip.querySelectorAll('[role="tab"]');
      for (var i = 0; i < btns.length; i += 1) {
        var isTarget = btns[i].getAttribute('data-sub') === sub;
        btns[i].setAttribute('aria-selected', isTarget ? 'true' : 'false');
      }
    }
    for (var j = 0; j < BUILD_SUB.length; j += 1) {
      var p = buildSubPanel(BUILD_SUB[j]);
      if (!p) continue;
      if (BUILD_SUB[j] === sub) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    }
    return sub;
  }

  function currentBuildSub() {
    var strip = buildSubTabStrip();
    if (!strip) return 'specs';
    var active = strip.querySelector('[role="tab"][aria-selected="true"]');
    return (active && active.getAttribute('data-sub')) || 'specs';
  }

  function readBuildFilterState() {
    var bar = buildBar();
    if (!bar) return null;
    var text = bar.querySelector('.rcf-filter-text');
    var state = { q: text ? text.value.trim() : '', buildable: false };
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      state[selects[i].getAttribute('data-filter-key') || 'select'] = selects[i].value;
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      state[toggles[j].getAttribute('data-filter-key') || 'toggle'] = toggles[j].checked;
    }
    return state;
  }

  function writeBuildFilterState(state) {
    var bar = buildBar();
    if (!bar) return;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) text.value = state.q || '';
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      var key = selects[i].getAttribute('data-filter-key') || '';
      selects[i].value = state[key] != null ? String(state[key]) : '';
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      var tkey = toggles[j].getAttribute('data-filter-key') || '';
      toggles[j].checked = state[tkey] === true || state[tkey] === 'true' || state[tkey] === '1';
    }
  }

  function applyBuildFilter() {
    var list = buildListNode();
    if (!list) return;
    var state = readBuildFilterState() || { q: '', status: '', domain: '', size: '', buildable: false };
    var qLower = (state.q || '').toLowerCase();
    var rows = list.querySelectorAll(':scope > details.rcf-row');
    var visible = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var hide = false;
      if (state.status && row.getAttribute('data-status') !== state.status) hide = true;
      if (!hide && state.domain && row.getAttribute('data-domain') !== state.domain) hide = true;
      if (!hide && state.size && row.getAttribute('data-size') !== state.size) hide = true;
      if (!hide && state.buildable && row.getAttribute('data-buildable') !== '1') hide = true;
      if (!hide && qLower) {
        var hay = row.getAttribute('data-text') || '';
        if (hay.indexOf(qLower) === -1) hide = true;
      }
      if (hide) row.setAttribute('hidden', '');
      else { row.removeAttribute('hidden'); visible += 1; }
    }
    var countEl = document.querySelector('[data-rcf-filterbar="build-specs"] .rcf-filter-count');
    if (countEl) countEl.textContent = String(visible) + ' of ' + String(rows.length) + ' visible';
  }

  function currentBuildHashExtras() {
    // Read the live hash, keep every param not owned by the Build
    // FilterBar + SubTabStrip so sub-tab / filter writes preserve the
    // selected entity and any other extension (decision 11 preservation
    // contract; same shape as currentRequirementsHashExtras).
    var raw = window.location.hash || '';
    if (raw[0] === '#') raw = raw.slice(1);
    if (!raw) return { entity: '', extraParts: [] };
    var pairs = raw.split('&');
    var entity = '';
    var extras = [];
    var owned = { tab: true, sub: true, q: true, status: true, domain: true, size: true, buildable: true, entity: true };
    for (var i = 0; i < pairs.length; i += 1) {
      var p = pairs[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var k = eq === -1 ? p : p.slice(0, eq);
      if (k === 'entity' && eq !== -1) { entity = decodeURIComponent(p.slice(eq + 1)); continue; }
      if (owned[k]) continue;
      extras.push(p);
    }
    return { entity: entity, extraParts: extras };
  }

  function currentDagHashExtras() {
    // On the DAG sub-tab, the Specs filter params (q/status/domain/size/
    // buildable) are UNKNOWN - the DAG does not own them. Preserve them
    // through DAG writes per the decision 11 preservation contract so
    // deep links like `#tab=build&sub=dag&entity=FBS-012&status=notStarted`
    // survive filter and selection changes.
    var raw = window.location.hash || '';
    if (raw[0] === '#') raw = raw.slice(1);
    if (!raw) return [];
    var pairs = raw.split('&');
    var extras = [];
    var owned = { tab: true, sub: true, entity: true };
    for (var i = 0; i < pairs.length; i += 1) {
      var p = pairs[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var k = eq === -1 ? p : p.slice(0, eq);
      if (owned[k]) continue;
      extras.push(p);
    }
    return extras;
  }

  function buildHashFragment() {
    var parts = ['tab=build'];
    var sub = currentBuildSub();
    if (sub && sub !== 'specs') parts.push('sub=' + encodeURIComponent(sub));
    if (sub === 'dag') {
      var canvas = dagCanvas();
      var sel = canvas && canvas.getAttribute('data-rcf-dag-sel');
      if (sel) parts.push('entity=' + encodeURIComponent(sel));
      // Preserve any non-DAG-owned params (Specs filter keys etc.)
      // through DAG writes. Entity is already written above from the
      // live selection; do NOT re-append extras.entity.
      var dagExtras = currentDagHashExtras();
      if (dagExtras.length > 0) parts = parts.concat(dagExtras);
      return '#' + parts.join('&');
    }
    var state = readBuildFilterState();
    if (state) {
      if (state.q) parts.push('q=' + encodeURIComponent(state.q));
      if (state.status) parts.push('status=' + encodeURIComponent(state.status));
      if (state.domain) parts.push('domain=' + encodeURIComponent(state.domain));
      if (state.size) parts.push('size=' + encodeURIComponent(state.size));
      if (state.buildable) parts.push('buildable=1');
    }
    var extras = currentBuildHashExtras();
    if (extras.entity) parts.push('entity=' + encodeURIComponent(extras.entity));
    // Decision 11: preserve unknown hash params through filter writes.
    if (extras.extraParts && extras.extraParts.length > 0) parts = parts.concat(extras.extraParts);
    return '#' + parts.join('&');
  }

  function writeBuildHash() {
    writeHash(buildHashFragment(), true);
  }

  function applyBuildHash(params) {
    var sub = params.sub ? decodeURIComponent(params.sub) : 'specs';
    activateBuildSub(sub);
    if (sub === 'dag') {
      var canvas = dagCanvas();
      var entity = params.entity ? decodeURIComponent(params.entity) : '';
      if (canvas) {
        if (entity) {
          canvas.setAttribute('data-rcf-dag-sel', entity);
          // AC-204-4: a deep link to an unconnected FBS must land visibly.
          // Auto-press Show-unconnected so the lane renders and the node
          // is not display:none when applyDagFilters runs below.
          var payload = parseDagInspectorPayload();
          if (payload[entity] && payload[entity].unconnected) {
            var tunc = document.querySelector('[data-rcf-dag-toggle="unconnected"]');
            if (tunc && tunc.getAttribute('aria-pressed') !== 'true') tunc.setAttribute('aria-pressed', 'true');
          }
        } else {
          canvas.removeAttribute('data-rcf-dag-sel');
        }
        applyDagFilters();
        renderDagInspector();
        if (entity) {
          var el = canvas.querySelector('.rcf-dag-node[data-fbs-id="' + entity + '"]');
          if (el) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { el.scrollIntoView(); } }
        }
      }
      return;
    }
    var state = {
      q: params.q ? decodeURIComponent(params.q) : '',
      status: params.status ? decodeURIComponent(params.status) : '',
      domain: params.domain ? decodeURIComponent(params.domain) : '',
      size: params.size ? decodeURIComponent(params.size) : '',
      buildable: params.buildable === '1' || params.buildable === 'true',
    };
    if (buildBar()) {
      writeBuildFilterState(state);
      applyBuildFilter();
    }
  }

  function expandAllBuildSpecs(open) {
    var list = buildListNode();
    if (!list) return;
    var rows = list.querySelectorAll(':scope > details.rcf-row');
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].hasAttribute('hidden')) continue;
      rows[i].open = !!open;
    }
    var btn = document.querySelector('[data-rcf-filterbar="build-specs"] .rcf-filter-expand');
    if (btn) {
      btn.textContent = open ? 'Collapse all' : 'Expand all';
      btn.setAttribute('data-expand-state', open ? 'expanded' : 'collapsed');
    }
  }

  function wireBuildFilterBar() {
    var bar = buildBar();
    if (!bar || bar.__rcfBuildFilterWired) return;
    bar.__rcfBuildFilterWired = true;
    var text = bar.querySelector('.rcf-filter-text');
    if (text) {
      var debounceTimer = null;
      text.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          applyBuildFilter();
          writeBuildHash();
        }, 150);
      });
    }
    var selects = bar.querySelectorAll('.rcf-filter-select');
    for (var i = 0; i < selects.length; i += 1) {
      selects[i].addEventListener('change', function () {
        applyBuildFilter();
        writeBuildHash();
      });
    }
    var toggles = bar.querySelectorAll('.rcf-filter-toggle input[type="checkbox"]');
    for (var j = 0; j < toggles.length; j += 1) {
      toggles[j].addEventListener('change', function () {
        applyBuildFilter();
        writeBuildHash();
      });
    }
    var expandBtn = bar.querySelector('.rcf-filter-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var isCollapsed = expandBtn.getAttribute('data-expand-state') !== 'expanded';
        expandAllBuildSpecs(isCollapsed);
      });
    }
  }

  function wireBuildSubTabStrip() {
    var strip = buildSubTabStrip();
    if (!strip || strip.__rcfBuildSubWired) return;
    strip.__rcfBuildSubWired = true;
    var btns = strip.querySelectorAll('[role="tab"]');
    for (var i = 0; i < btns.length; i += 1) {
      btns[i].addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var sub = ev.currentTarget.getAttribute('data-sub');
        if (!sub) return;
        activateBuildSub(sub);
        if (sub === 'dag' && dagCanvas()) {
          applyDagFilters();
          renderDagInspector();
        }
        writeBuildHash();
      });
    }
  }

  function wireBuildTab() {
    wireBuildSubTabStrip();
    wireBuildFilterBar();
    wireBuildDag();
  }

  // ---- Build / DAG (viewer UI refresh PR 6, TAC-4131, ADR-4133) --------
  //
  // Client-side wiring for the Build/DAG sub-tab. The server emits the
  // layout (toolbar, canvas with HTML nodes + SVG edges, inspector shell,
  // unconnected lane) plus an inline <script type="application/json"
  // data-rcf-dag-inspector-data> payload keyed by fbsId. The client:
  //   - toggles filters (status chips, area, Buildable-now, Critical-path,
  //     Show-unconnected) by setting data attributes on nodes and edges;
  //   - handles click-to-highlight: selects a node, writes
  //     `#tab=build&sub=dag&entity=<id>` through writeHash, outlines its
  //     upstream closure in link colour and downstream in warning;
  //   - fills the inspector from the inline payload (no outbound fetch,
  //     no postMessage), with Open-in-Specs linking to
  //     `#tab=build&sub=specs&entity=<id>` (REQ-002 / US-204 AC-204-7).

  function dagRoot() { return document.querySelector('[data-rcf-dag="build"]'); }
  function dagCanvas() { return document.querySelector('[data-rcf-dag-canvas]'); }
  function dagToolbar() { return document.querySelector('[data-rcf-dag-toolbar]'); }
  function dagInspectorBody() { return document.querySelector('[data-rcf-dag-inspector-body]'); }

  function parseDagInspectorPayload() {
    // PR 1 contract (standing criterion): payload rides on the inspector
    // shell as a `data-rcf-dag-inspector-data` attribute, not an inline
    // `<script>` body.
    var shell = document.querySelector('[data-rcf-dag-inspector-body]');
    if (!shell) return {};
    var raw = shell.getAttribute('data-rcf-dag-inspector-data');
    if (!raw) return {};
    try { return JSON.parse(raw); }
    catch (e) { return {}; }
  }

  function dagEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readDagState() {
    var state = {
      statuses: { notStarted: true, inProgress: true, complete: true, verified: true },
      domain: '',
      buildable: false,
      critical: false,
      unconnected: false,
      sel: null,
    };
    var bar = dagToolbar();
    if (bar) {
      var statusChips = bar.querySelectorAll('[data-rcf-dag-status]');
      for (var i = 0; i < statusChips.length; i += 1) {
        var k = statusChips[i].getAttribute('data-rcf-dag-status');
        state.statuses[k] = statusChips[i].getAttribute('aria-pressed') === 'true';
      }
      var dom = bar.querySelector('[data-rcf-dag-domain]');
      if (dom) state.domain = dom.value || '';
      var tbuild = bar.querySelector('[data-rcf-dag-toggle="buildable"]');
      if (tbuild) state.buildable = tbuild.getAttribute('aria-pressed') === 'true';
      var tcrit = bar.querySelector('[data-rcf-dag-toggle="critical"]');
      if (tcrit) state.critical = tcrit.getAttribute('aria-pressed') === 'true';
      var tunc = bar.querySelector('[data-rcf-dag-toggle="unconnected"]');
      if (tunc) state.unconnected = tunc.getAttribute('aria-pressed') === 'true';
    }
    var canvas = dagCanvas();
    if (canvas) state.sel = canvas.getAttribute('data-rcf-dag-sel') || null;
    return state;
  }

  function dagClosure(payload, startId, dir) {
    var out = {};
    if (!payload[startId]) return out;
    var stack = (dir === 'up' ? payload[startId].needs : payload[startId].waits).slice();
    while (stack.length > 0) {
      var cur = stack.pop();
      if (out[cur]) continue;
      out[cur] = true;
      var p = payload[cur];
      if (!p) continue;
      var next = dir === 'up' ? p.needs : p.waits;
      for (var i = 0; i < next.length; i += 1) stack.push(next[i]);
    }
    return out;
  }

  function applyDagFilters() {
    var canvas = dagCanvas();
    if (!canvas) return;
    var payload = parseDagInspectorPayload();
    var state = readDagState();
    if (state.unconnected) canvas.removeAttribute('data-rcf-dag-unconnected-hidden');
    else canvas.setAttribute('data-rcf-dag-unconnected-hidden', '1');

    var ups = {};
    var downs = {};
    if (state.sel && payload[state.sel]) {
      ups = dagClosure(payload, state.sel, 'up');
      downs = dagClosure(payload, state.sel, 'down');
    }
    if (state.sel) canvas.setAttribute('data-rcf-dag-sel', state.sel);
    else canvas.removeAttribute('data-rcf-dag-sel');

    var nodes = canvas.querySelectorAll('.rcf-dag-node');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var id = el.getAttribute('data-fbs-id');
      var status = el.getAttribute('data-status') || '';
      var domain = el.getAttribute('data-domain') || '';
      var buildable = el.getAttribute('data-buildable') === '1';
      var critical = el.getAttribute('data-critical') === '1';
      var unconnected = el.getAttribute('data-unconnected') === '1';
      var hide = false;
      if (state.statuses[status] === false) hide = true;
      if (!hide && state.domain && domain !== state.domain) hide = true;
      if (!hide && state.buildable && !buildable) hide = true;
      if (!hide && state.critical && !critical) hide = true;
      if (unconnected && !state.unconnected) hide = true;
      if (hide) el.setAttribute('data-rcf-dag-hidden', '1');
      else el.removeAttribute('data-rcf-dag-hidden');
      var role = '';
      if (state.sel) {
        if (id === state.sel) role = 'sel';
        else if (ups[id]) role = 'up';
        else if (downs[id]) role = 'down';
      }
      if (role) el.setAttribute('data-rcf-dag-role', role);
      else el.removeAttribute('data-rcf-dag-role');
      if (state.critical && critical) el.setAttribute('data-rcf-dag-critical', 'on');
      else el.removeAttribute('data-rcf-dag-critical');
    }

    var edges = canvas.querySelectorAll('[data-rcf-dag-edge]');
    for (var j = 0; j < edges.length; j += 1) {
      var ed = edges[j];
      var from = ed.getAttribute('data-from');
      var to = ed.getAttribute('data-to');
      var fromNode = canvas.querySelector('.rcf-dag-node[data-fbs-id="' + from + '"]');
      var toNode = canvas.querySelector('.rcf-dag-node[data-fbs-id="' + to + '"]');
      var filtered = (fromNode && fromNode.getAttribute('data-rcf-dag-hidden') === '1')
        || (toNode && toNode.getAttribute('data-rcf-dag-hidden') === '1');
      if (filtered) ed.setAttribute('data-rcf-dag-hidden', '1');
      else ed.removeAttribute('data-rcf-dag-hidden');
      var erole = '';
      if (state.sel) {
        var fromUp = from === state.sel || ups[from];
        var toUp = to === state.sel || ups[to];
        var fromDown = from === state.sel || downs[from];
        var toDown = to === state.sel || downs[to];
        if (fromUp && toUp) erole = 'up';
        else if (fromDown && toDown) erole = 'down';
      }
      if (erole) ed.setAttribute('data-rcf-dag-edge-role', erole);
      else ed.removeAttribute('data-rcf-dag-edge-role');
    }
  }

  function renderDagInspector() {
    var body = dagInspectorBody();
    if (!body) return;
    var payload = parseDagInspectorPayload();
    var state = readDagState();
    if (!state.sel || !payload[state.sel]) {
      body.innerHTML = '<div class="muted small">Select a build spec to see what it needs and what waits on it.</div>';
      return;
    }
    var f = payload[state.sel];
    var meta = '<div class="rcf-dag-inspector-meta">'
      + '<span class="rcf-pill rcf-pill--doc-status rcf-pill--' + dagEscape((f.status || '').toLowerCase()) + '">' + dagEscape(f.status || 'unknown') + '</span>'
      + (f.domain ? '<span class="rcf-badge rcf-badge--facet">' + dagEscape(f.domain) + '</span>' : '')
      + '<span class="rcf-badge rcf-badge--count">AC ' + (f.acCount || 0) + '</span>'
      + (f.size ? '<span class="rcf-badge rcf-badge--facet">' + dagEscape(f.size) + '</span>' : '')
      + '<span class="rcf-badge rcf-badge--count">order ' + (f.buildOrder != null ? f.buildOrder : '') + '</span>'
      + (f.buildable ? '<span class="rcf-pill rcf-pill--build-queue">buildable now</span>' : '')
      + (f.critical ? '<span class="rcf-pill rcf-pill--doc-status">critical path</span>' : '')
      + '</div>';
    var needsItems = (f.needsMeta || []).map(function (m) {
      return '<li><a class="mono" href="#" data-rcf-dag-go="' + dagEscape(m.id) + '">' + dagEscape(m.id) + '</a> <span>' + dagEscape(m.title) + '</span> <span class="rcf-pill rcf-pill--doc-status rcf-pill--' + dagEscape((m.status || '').toLowerCase()) + '">' + dagEscape(m.status || '?') + '</span></li>';
    }).join('');
    var needsBlock = '<h4>Needs first (' + (f.needs ? f.needs.length : 0) + ' direct, ' + (f.needsTotal || 0) + ' in total)</h4>'
      + (needsItems ? '<ul class="rcf-dag-inspector-list">' + needsItems + '</ul>' : '<div class="muted small">Nothing.</div>');
    var waitsItems = (f.waitsMeta || []).map(function (m) {
      return '<li><a class="mono" href="#" data-rcf-dag-go="' + dagEscape(m.id) + '">' + dagEscape(m.id) + '</a> <span>' + dagEscape(m.title) + '</span></li>';
    }).join('');
    var waitsBlock = '<h4>Waits on this (' + (f.waits ? f.waits.length : 0) + ' direct, ' + (f.waitsTotal || 0) + ' in total)</h4>'
      + (waitsItems ? '<ul class="rcf-dag-inspector-list">' + waitsItems + '</ul>' : '<div class="muted small">Nothing.</div>');
    var footer = '<p class="small" style="margin-top:0.8rem"><a href="#tab=build&sub=specs&entity=' + dagEscape(f.id) + '" data-rcf-dag-open-specs>Open in Specs</a> &middot; <a href="#" data-rcf-dag-go="" class="muted">Clear selection</a></p>';
    body.innerHTML = '<div class="mono small" style="color:var(--sv-link)">' + dagEscape(f.id) + '</div>'
      + '<h3>' + dagEscape(f.title) + '</h3>'
      + meta
      + needsBlock
      + waitsBlock
      + footer;

    var goLinks = body.querySelectorAll('[data-rcf-dag-go]');
    for (var i = 0; i < goLinks.length; i += 1) {
      goLinks[i].addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var next = ev.currentTarget.getAttribute('data-rcf-dag-go');
        if (!next) selectDagNode(null);
        else selectDagNode(next);
      });
    }
    var specsLink = body.querySelector('[data-rcf-dag-open-specs]');
    if (specsLink) {
      specsLink.addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var href = ev.currentTarget.getAttribute('href') || '';
        writeHash(href, false);
        resolveHash(window.location.hash);
      });
    }
  }

  function selectDagNode(id) {
    var canvas = dagCanvas();
    if (!canvas) return;
    var cur = canvas.getAttribute('data-rcf-dag-sel') || null;
    var payload = parseDagInspectorPayload();
    var next = id === cur ? null : id;
    if (next && !payload[next]) next = null;
    if (next) canvas.setAttribute('data-rcf-dag-sel', next);
    else canvas.removeAttribute('data-rcf-dag-sel');
    if (next && payload[next] && payload[next].unconnected) {
      var tunc = document.querySelector('[data-rcf-dag-toggle="unconnected"]');
      if (tunc && tunc.getAttribute('aria-pressed') !== 'true') tunc.setAttribute('aria-pressed', 'true');
    }
    applyDagFilters();
    renderDagInspector();
    writeBuildHash();
    if (next) {
      var el = canvas.querySelector('.rcf-dag-node[data-fbs-id="' + next + '"]');
      if (el) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { el.scrollIntoView(); } }
    }
  }

  function wireBuildDag() {
    var root = dagRoot();
    if (!root || root.__rcfBuildDagWired) return;
    root.__rcfBuildDagWired = true;
    var canvas = dagCanvas();
    if (canvas) {
      var nodes = canvas.querySelectorAll('.rcf-dag-node');
      for (var i = 0; i < nodes.length; i += 1) {
        nodes[i].addEventListener('click', function (ev) {
          ev.preventDefault && ev.preventDefault();
          var id = ev.currentTarget.getAttribute('data-fbs-id');
          if (id) selectDagNode(id);
        });
      }
    }
    var bar = dagToolbar();
    if (bar) {
      var statusChips = bar.querySelectorAll('[data-rcf-dag-status]');
      for (var j = 0; j < statusChips.length; j += 1) {
        statusChips[j].addEventListener('click', function (ev) {
          var btn = ev.currentTarget;
          btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
          applyDagFilters();
        });
      }
      var dom = bar.querySelector('[data-rcf-dag-domain]');
      if (dom) dom.addEventListener('change', function () { applyDagFilters(); });
      var toggles = bar.querySelectorAll('[data-rcf-dag-toggle]');
      for (var k = 0; k < toggles.length; k += 1) {
        toggles[k].addEventListener('click', function (ev) {
          var btn = ev.currentTarget;
          btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
          applyDagFilters();
        });
      }
    }
    applyDagFilters();
    renderDagInspector();
  }

  // ---- EntitySelector (viewer UI refresh PR 3, decision 4) -----

  function parseEntitySelectorPayload(root) {
    // Payload rides on the container as a `data-items` attribute so
    // the shell carries no inline <script> body (PR 1 contract).
    var raw = root.getAttribute('data-items');
    if (!raw) return [];
    try { return JSON.parse(raw); }
    catch (e) { return []; }
  }

  function wireEntitySelector(root) {
    if (!root || root.__rcfEntitySelectorWired) return;
    root.__rcfEntitySelectorWired = true;
    var input = root.querySelector('.rcf-entity-selector-input');
    var results = root.querySelector('.rcf-entity-selector-results');
    var targetTab = root.getAttribute('data-target-tab') || 'requirements';
    var items = parseEntitySelectorPayload(root);
    if (!input || !results || items.length === 0) return;

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function render(matches) {
      if (matches.length === 0) {
        results.innerHTML = '<div class="rcf-entity-selector-empty muted small">No match.</div>';
        results.removeAttribute('hidden');
        return;
      }
      var html = '';
      for (var i = 0; i < matches.length; i += 1) {
        var m = matches[i];
        var hash = '#tab=' + encodeURIComponent(targetTab) + '&entity=' + encodeURIComponent(m.id);
        html += '<a class="rcf-entity-selector-result" href="' + escapeHtml(hash) + '" role="option" data-entity-id="' + escapeHtml(m.id) + '">'
          + '<span class="rcf-entity-selector-result-id">' + escapeHtml(m.id) + '</span>'
          + '<span class="rcf-entity-selector-result-title">' + escapeHtml(m.title) + '</span>'
          + (m.facet ? '<span class="rcf-entity-selector-result-facet">' + escapeHtml(m.facet) + '</span>' : '')
          + '</a>';
      }
      results.innerHTML = html;
      results.removeAttribute('hidden');
    }

    function run() {
      var q = (input.value || '').trim().toLowerCase();
      if (!q) { results.innerHTML = ''; results.setAttribute('hidden', ''); return; }
      var out = [];
      for (var i = 0; i < items.length && out.length < 12; i += 1) {
        var it = items[i];
        var idL = (it.id || '').toLowerCase();
        var tL = (it.title || '').toLowerCase();
        if (idL.indexOf(q) === 0 || tL.indexOf(q) !== -1) out.push(it);
      }
      render(out);
    }

    input.addEventListener('input', run);
    input.addEventListener('focus', function () { if (input.value.trim()) run(); });
    input.addEventListener('blur', function () {
      setTimeout(function () { results.setAttribute('hidden', ''); }, 150);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var first = results.querySelector('.rcf-entity-selector-result');
      if (!first) return;
      ev.preventDefault && ev.preventDefault();
      // Navigate via the Router: writes to hash so #entity=... resolves.
      var href = first.getAttribute('href');
      if (href) {
        writeHash(href, false);
        resolveHash(window.location.hash);
      }
    });
  }

  function wireEntitySelectors() {
    var selectors = document.querySelectorAll('[data-rcf-entity-selector]');
    for (var i = 0; i < selectors.length; i += 1) wireEntitySelector(selectors[i]);
  }

  // ---- ID lookup (viewer UI refresh PR 7, TAC-4132) --------------------
  //
  // SearchButton + LookupModal + Cmd/Ctrl+F. The index at `./index.json`
  // is fetched lazily on first open; the SSE tree-update broadcast sets
  // __rcfLookupDirty so the next open refetches. Rank order (design
  // doc section 6): a single character searches ids only; otherwise ids
  // rank first (exact > prefix > contains), then every query word must
  // match title or snippet, title above snippet; 20 results; matches
  // marked. A pick writes `#tab=<tab>&entity=<id>` through writeHash so
  // `?embed=` and `?theme=` survive (Dex contract, PR 1).

  var lookupRows = null;
  var lookupFetching = false;
  var lookupLastQuery = null;
  var lookupResults = [];
  var lookupActiveIdx = -1;
  var lookupPrevFocus = null;
  var lookupLoadError = false;
  var lookupKeybindWired = false;

  function lookupModal() { return document.querySelector('[data-rcf-lookup]'); }
  function lookupInput() { return document.querySelector('[data-rcf-lookup-input]'); }
  function lookupResultsList() { return document.querySelector('[data-rcf-lookup-results]'); }
  function lookupEmpty() { return document.querySelector('[data-rcf-lookup-empty]'); }
  function lookupEmptyMsg() { return document.querySelector('[data-rcf-lookup-empty-msg]'); }
  function lookupReload() { return document.querySelector('[data-rcf-lookup-reload]'); }
  function lookupStatus() { return document.querySelector('[data-rcf-lookup-status]'); }

  function lookupEscapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lookupMarkMatches(text, needles) {
    if (!text) return '';
    var lower = text.toLowerCase();
    var marks = [];
    for (var i = 0; i < needles.length; i += 1) {
      var n = needles[i];
      if (!n) continue;
      var from = 0;
      while (from <= lower.length) {
        var at = lower.indexOf(n, from);
        if (at === -1) break;
        marks.push([at, at + n.length]);
        from = at + n.length;
      }
    }
    if (marks.length === 0) return lookupEscapeHtml(text);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    for (var j = 0; j < marks.length; j += 1) {
      var last = merged[merged.length - 1];
      if (last && marks[j][0] <= last[1]) last[1] = Math.max(last[1], marks[j][1]);
      else merged.push(marks[j].slice());
    }
    var out = '';
    var cursor = 0;
    for (var k = 0; k < merged.length; k += 1) {
      var start = merged[k][0];
      var end = merged[k][1];
      if (cursor < start) out += lookupEscapeHtml(text.slice(cursor, start));
      out += '<mark>' + lookupEscapeHtml(text.slice(start, end)) + '</mark>';
      cursor = end;
    }
    if (cursor < text.length) out += lookupEscapeHtml(text.slice(cursor));
    return out;
  }

  function lookupRank(query, rows) {
    if (!query || !rows) return [];
    var q = String(query).trim().toLowerCase();
    if (!q) return [];
    var scored = [];
    // Single-character query: id-only match (design doc section 6).
    if (q.length === 1) {
      for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        var idLow = (r.id || '').toLowerCase();
        if (idLow.indexOf(q) !== -1) {
          var score = 0;
          if (idLow === q) score = 1000;
          else if (idLow.indexOf(q) === 0) score = 500;
          else score = 100;
          scored.push({ row: r, score: score, needles: [q] });
        }
      }
    } else {
      var words = q.split(/\s+/).filter(Boolean);
      for (var i2 = 0; i2 < rows.length; i2 += 1) {
        var r2 = rows[i2];
        var idLow2 = (r2.id || '').toLowerCase();
        var titleLow = (r2.title || '').toLowerCase();
        var snipLow = (r2.snippet || '').toLowerCase();
        var score2 = 0;
        // Id first: exact / prefix / contains against the full query.
        if (idLow2 === q) score2 = 10000;
        else if (idLow2.indexOf(q) === 0) score2 = 5000;
        else if (idLow2.indexOf(q) !== -1) score2 = 2500;
        else {
          // Word-match pass: every word must hit title or snippet.
          var titleHits = 0;
          var snipHits = 0;
          var allHit = true;
          for (var w = 0; w < words.length; w += 1) {
            var word = words[w];
            var inTitle = titleLow.indexOf(word) !== -1;
            var inSnip = snipLow.indexOf(word) !== -1;
            if (inTitle) titleHits += 1;
            else if (inSnip) snipHits += 1;
            else { allHit = false; break; }
          }
          if (!allHit) continue;
          // Title above snippet: title hits weighted higher than snippet.
          score2 = 1000 + titleHits * 50 + snipHits * 10;
        }
        if (score2 > 0) scored.push({ row: r2, score: score2, needles: words });
      }
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.row.id || '').localeCompare(b.row.id || '');
    });
    return scored.slice(0, 20);
  }

  function lookupKindLabel(kind) {
    switch (kind) {
      case 'prd': return 'PRD';
      case 'req': return 'REQ';
      case 'us': return 'US';
      case 'ac': return 'AC';
      case 'tad': return 'TAD';
      case 'tac': return 'TAC';
      case 'adr': return 'ADR';
      case 'bs': return 'BS';
      case 'fbs': return 'FBS';
      case 'ts': return 'TS';
      default: return kind || '';
    }
  }

  function lookupRenderResults(results) {
    var list = lookupResultsList();
    var empty = lookupEmpty();
    var emptyMsg = lookupEmptyMsg();
    var reload = lookupReload();
    var status = lookupStatus();
    if (!list) return;
    if (results.length === 0) {
      list.innerHTML = '';
      list.hidden = true;
      var hasQuery = (lookupLastQuery || '').trim().length > 0;
      if (empty) empty.hidden = !lookupLoadError && !hasQuery;
      if (emptyMsg) emptyMsg.textContent = lookupLoadError ? 'The index could not be loaded.' : 'No matches.';
      if (reload) reload.hidden = !lookupLoadError;
      if (status) {
        if (lookupLoadError) status.textContent = 'Index failed to load.';
        else if (hasQuery) status.textContent = 'No matches.';
        else status.textContent = (lookupRows ? 'Type an id or a few words.' : 'Loading index...');
      }
      return;
    }
    if (empty) empty.hidden = true;
    if (reload) reload.hidden = true;
    list.hidden = false;
    var html = '';
    for (var i = 0; i < results.length; i += 1) {
      var scored = results[i];
      var r = scored.row;
      var needles = scored.needles || [];
      var active = i === lookupActiveIdx ? ' is-active' : '';
      var markedId = lookupMarkMatches(r.id || '', needles);
      var markedTitle = lookupMarkMatches(r.title || '', needles);
      var markedSnip = lookupMarkMatches(r.snippet || '', needles);
      var parentHtml = r.parent ? ' <span class="rcf-lookup-parent">in ' + lookupEscapeHtml(r.parent) + '</span>' : '';
      html += '<li class="rcf-lookup-row' + active + '" role="option"'
        + (i === lookupActiveIdx ? ' aria-selected="true"' : '')
        + ' data-rcf-lookup-row data-rcf-lookup-id="' + lookupEscapeHtml(r.id || '')
        + '" data-rcf-lookup-tab="' + lookupEscapeHtml(r.tab || '')
        + '" data-rcf-lookup-kind="' + lookupEscapeHtml(r.kind || '')
        + '" data-rcf-lookup-parent="' + lookupEscapeHtml(r.parent || '') + '" data-rcf-lookup-idx="' + i + '">'
        + '<span class="rcf-lookup-kind rcf-lookup-kind-' + lookupEscapeHtml(r.kind || '') + '">' + lookupKindLabel(r.kind) + '</span>'
        + '<span class="rcf-lookup-id">' + markedId + '</span>'
        + (r.title ? '<span class="rcf-lookup-title">' + markedTitle + '</span>' : '')
        + parentHtml
        + (r.snippet ? '<p class="rcf-lookup-snippet">' + markedSnip + '</p>' : '')
        + '</li>';
    }
    list.innerHTML = html;
    if (status) status.textContent = results.length + ' result' + (results.length === 1 ? '' : 's') + '.';
  }

  function lookupRun() {
    var input = lookupInput();
    if (!input) return;
    var query = input.value || '';
    lookupLastQuery = query;
    if (!lookupRows) {
      lookupResults = [];
      lookupActiveIdx = -1;
      var list = lookupResultsList();
      if (list) { list.innerHTML = ''; list.hidden = true; }
      var empty = lookupEmpty();
      var emptyMsg = lookupEmptyMsg();
      var reload = lookupReload();
      if (empty) empty.hidden = false;
      if (emptyMsg) emptyMsg.textContent = lookupLoadError ? 'The index could not be loaded.' : (lookupFetching ? 'Loading index...' : 'Index not loaded.');
      if (reload) reload.hidden = !lookupLoadError;
      return;
    }
    lookupResults = lookupRank(query, lookupRows);
    lookupActiveIdx = lookupResults.length > 0 ? 0 : -1;
    lookupRenderResults(lookupResults);
  }

  function lookupLoad(force) {
    if (lookupFetching) return;
    if (lookupRows && !force && !window.__rcfLookupDirty) { lookupRun(); return; }
    lookupFetching = true;
    lookupLoadError = false;
    var status = lookupStatus();
    if (status) status.textContent = 'Loading index...';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', './index.json', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      lookupFetching = false;
      var ok = xhr.status >= 200 && xhr.status < 300;
      var parsed = null;
      if (ok) {
        try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
      }
      if (!ok || !parsed || !Array.isArray(parsed.rows)) {
        lookupLoadError = true;
        lookupRows = null;
        lookupRun();
        return;
      }
      lookupLoadError = false;
      lookupRows = parsed.rows;
      window.__rcfLookupDirty = false;
      lookupRun();
    };
    try { xhr.send(); } catch (e) { lookupFetching = false; lookupLoadError = true; lookupRun(); }
  }

  function lookupOpen() {
    var modal = lookupModal();
    if (!modal) return;
    if (modal.hidden === false) return;
    lookupPrevFocus = document.activeElement;
    modal.hidden = false;
    document.documentElement.setAttribute('data-rcf-lookup-open', '1');
    var input = lookupInput();
    if (input) {
      input.value = '';
      try { input.focus(); } catch (e) { /* soft */ }
    }
    lookupLastQuery = '';
    lookupResults = [];
    lookupActiveIdx = -1;
    var list = lookupResultsList();
    if (list) { list.innerHTML = ''; list.hidden = true; }
    var empty = lookupEmpty();
    if (empty) empty.hidden = true;
    lookupLoad(false);
  }

  function lookupClose() {
    var modal = lookupModal();
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.documentElement.removeAttribute('data-rcf-lookup-open');
    if (lookupPrevFocus && typeof lookupPrevFocus.focus === 'function') {
      try { lookupPrevFocus.focus(); } catch (e) { /* soft */ }
    }
    lookupPrevFocus = null;
  }

  function lookupMove(delta) {
    if (lookupResults.length === 0) return;
    var next = lookupActiveIdx + delta;
    if (next < 0) next = lookupResults.length - 1;
    else if (next >= lookupResults.length) next = 0;
    lookupActiveIdx = next;
    lookupRenderResults(lookupResults);
    var row = document.querySelector('[data-rcf-lookup-row][data-rcf-lookup-idx="' + next + '"]');
    if (row && typeof row.scrollIntoView === 'function') {
      try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* soft */ }
    }
  }

  function lookupPick(row) {
    if (!row) return;
    var id = row.getAttribute('data-rcf-lookup-id');
    var tab = row.getAttribute('data-rcf-lookup-tab');
    if (!id || !tab) return;
    // Design decision 6: test suites render inside their owning US (not
    // a Build sub-tab). A TS pick re-routes to the US id so the Router
    // opens the US and the TS card inside it (viewer stream carry).
    var kind = row.getAttribute('data-rcf-lookup-kind');
    var parentId = row.getAttribute('data-rcf-lookup-parent');
    if (kind === 'ts' && parentId) { id = parentId; tab = 'requirements'; }
    lookupClose();
    // FBS-208 (AC-209-3): a lookup hit while the Readiness tab is
    // active lands on the Trace sub-tab for the chosen id (preserves
    // embed/theme via the writeHash contract). The chain pivots the
    // Trace matrix supports are PRD/REQ/US/AC/TS/TC/FBS/CN/TAC/ADR.
    var activeTabBtn = document.querySelector('.tabs [role="tab"][aria-selected="true"]');
    var active = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : '';
    if (active === 'readiness' && /^(PRD|REQ|US|AC|TS|TC|FBS|CN|TAC|ADR)-/.test(id)) {
      writeHash('#tab=readiness&sub=trace&entity=' + encodeURIComponent(id), false);
      resolveHash(window.location.hash);
      return;
    }
    // writeHash preserves ?embed=/?theme=/... (Dex contract, PR 1); the
    // Router's hashchange listener then activates the tab and opens
    // every ancestor DocRow (resolveHash).
    writeHash('#tab=' + encodeURIComponent(tab) + '&entity=' + encodeURIComponent(id), false);
    // If the hash was already the same (user picked the current entity
    // again), writeHash is a no-op and no hashchange fires. Re-resolve
    // to re-flash the target in that case.
    resolveHash(window.location.hash);
  }

  function lookupOnKeydown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault && ev.preventDefault();
      lookupClose();
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault && ev.preventDefault();
      lookupMove(1);
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault && ev.preventDefault();
      lookupMove(-1);
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault && ev.preventDefault();
      if (lookupActiveIdx < 0 || lookupActiveIdx >= lookupResults.length) return;
      var row = document.querySelector('[data-rcf-lookup-row][data-rcf-lookup-idx="' + lookupActiveIdx + '"]');
      lookupPick(row);
    }
  }

  function lookupOnInput() {
    lookupRun();
  }

  // Readiness StageLegend (viewer UI refresh PR 8). Any element carrying
  // `data-rcf-stage-ref="Dn"` opens the stage legend dialog focused on
  // that row. The dialog is server-rendered (readiness/stage-legend.js);
  // this wiring is purely a click + <dialog>.showModal() delegation.
  var stageLegendWired = false;
  function wireStageLegend() {
    if (stageLegendWired) return;
    stageLegendWired = true;
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.getAttribute && el.getAttribute('data-rcf-stage-ref') !== null) {
          var stage = el.getAttribute('data-rcf-stage-ref');
          var dialog = document.getElementById('rcf-stage-legend');
          if (!dialog) return;
          var rows = dialog.querySelectorAll('tr[data-stage]');
          for (var i = 0; i < rows.length; i += 1) {
            if (rows[i].getAttribute('data-stage') === stage) {
              rows[i].classList.add('rcf-stage-legend__highlighted');
            } else {
              rows[i].classList.remove('rcf-stage-legend__highlighted');
            }
          }
          if (typeof dialog.showModal === 'function' && !dialog.open) {
            ev.preventDefault && ev.preventDefault();
            dialog.showModal();
          } else if (!dialog.open) {
            ev.preventDefault && ev.preventDefault();
            dialog.setAttribute('open', '');
          }
          return;
        }
        el = el.parentNode;
      }
    });
  }

  function wireLookup() {
    var modal = lookupModal();
    if (modal && !modal.__rcfLookupWired) {
      modal.__rcfLookupWired = true;
      var input = lookupInput();
      if (input) {
        input.addEventListener('input', lookupOnInput);
        input.addEventListener('keydown', lookupOnKeydown);
      }
      var closeBtn = document.querySelector('[data-rcf-lookup-close]');
      if (closeBtn) closeBtn.addEventListener('click', function (ev) { ev.preventDefault && ev.preventDefault(); lookupClose(); });
      var backdrop = document.querySelector('[data-rcf-lookup-backdrop]');
      if (backdrop) backdrop.addEventListener('click', function () { lookupClose(); });
      var reload = lookupReload();
      if (reload) reload.addEventListener('click', function (ev) { ev.preventDefault && ev.preventDefault(); lookupLoad(true); });
      var list = lookupResultsList();
      if (list) {
        list.addEventListener('click', function (ev) {
          var el = ev.target;
          while (el && el !== list) {
            if (el.getAttribute && el.getAttribute('data-rcf-lookup-row') !== null) {
              ev.preventDefault && ev.preventDefault();
              lookupPick(el);
              return;
            }
            el = el.parentNode;
          }
        });
        list.addEventListener('mousemove', function (ev) {
          var el = ev.target;
          while (el && el !== list) {
            if (el.getAttribute && el.getAttribute('data-rcf-lookup-idx') !== null) {
              var idx = Number(el.getAttribute('data-rcf-lookup-idx'));
              if (!Number.isNaN(idx) && idx !== lookupActiveIdx) {
                lookupActiveIdx = idx;
                lookupRenderResults(lookupResults);
              }
              return;
            }
            el = el.parentNode;
          }
        });
      }
    }
    var btn = document.querySelector('[data-rcf-search]');
    if (btn && !btn.__rcfLookupWired) {
      btn.__rcfLookupWired = true;
      btn.addEventListener('click', function (ev) { ev.preventDefault && ev.preventDefault(); lookupOpen(); });
    }
    if (!lookupKeybindWired) {
      lookupKeybindWired = true;
      // Cmd/Ctrl+F opens the modal; Cmd/Ctrl+Shift+F stays the browser's
      // in-page find (design doc section 11 recommendation 1).
      document.addEventListener('keydown', function (ev) {
        var mod = ev.ctrlKey || ev.metaKey;
        if (!mod) return;
        if (ev.shiftKey) return;
        if ((ev.key === 'f' || ev.key === 'F')) {
          ev.preventDefault && ev.preventDefault();
          var modalEl = lookupModal();
          if (modalEl && modalEl.hidden === false) {
            var inp = lookupInput();
            if (inp) try { inp.focus(); inp.select && inp.select(); } catch (e) { /* soft */ }
          } else {
            lookupOpen();
          }
        }
      });
    }
  }

  var hashchangeWired = false;

  // ---- Readiness SubTabStrip (FBS-206, TAC-4135, AC-18005-2 and -8) ----
  //
  // The Readiness tab carries a SubTabStrip with five sub-views
  // (overview, questions, blocking, coverage, trace). The strip and
  // the sub-panels live inside #tab-readiness, so they survive an
  // SSE innerHTML swap of #rcf-live-content (the swap re-runs
  // onReady, which calls wireReadinessSubTabStrip and resolveHash;
  // the latter calls applyReadinessHash to restore sub= from the URL
  // when the hash has it). Unknown sub= drops to overview and is
  // removed from the hash.

  var READINESS_SUBS = ['overview', 'questions', 'blocking', 'coverage', 'trace'];

  function readinessSubTabStrip() {
    return document.querySelector('[data-rcf-subtabstrip="readiness"]');
  }

  function readinessSubPanel(sub) {
    return document.querySelector('[data-rcf-subpanel="' + sub + '"]');
  }

  function activateReadinessSub(sub) {
    if (READINESS_SUBS.indexOf(sub) === -1) sub = 'overview';
    var strip = readinessSubTabStrip();
    if (strip) {
      var btns = strip.querySelectorAll('[role="tab"]');
      for (var i = 0; i < btns.length; i += 1) {
        var isTarget = btns[i].getAttribute('data-sub') === sub;
        btns[i].setAttribute('aria-selected', isTarget ? 'true' : 'false');
      }
    }
    for (var j = 0; j < READINESS_SUBS.length; j += 1) {
      var p = readinessSubPanel(READINESS_SUBS[j]);
      if (!p) continue;
      if (READINESS_SUBS[j] === sub) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    }
    return sub;
  }

  function currentReadinessSub() {
    var strip = readinessSubTabStrip();
    if (!strip) return 'overview';
    var active = strip.querySelector('[role="tab"][aria-selected="true"]');
    return (active && active.getAttribute('data-sub')) || 'overview';
  }

  function readinessHashFragment() {
    var parts = ['tab=readiness'];
    var sub = currentReadinessSub();
    if (sub && sub !== 'overview') parts.push('sub=' + encodeURIComponent(sub));
    return '#' + parts.join('&');
  }

  function writeReadinessHash() {
    writeHash(readinessHashFragment(), true);
  }

  function applyReadinessHash(params) {
    // decodeURIComponent throws URIError on malformed input such as a
    // bare '%' or an incomplete escape. Treat that as unknown so the
    // overview fallback and hash-drop still fire (AC-18005-8).
    var raw = 'overview';
    var decodeFailed = false;
    if (params && params.sub) {
      try { raw = decodeURIComponent(params.sub); } catch (e) { decodeFailed = true; raw = params.sub; }
    }
    var known = !decodeFailed && READINESS_SUBS.indexOf(raw) !== -1;
    var sub = known ? raw : 'overview';
    activateReadinessSub(sub);
    // AC-18005-8: unknown sub= is dropped from the hash and the overview
    // is activated. Rewrite the hash in place without pushing a new entry.
    if (!known && params && params.sub) {
      try {
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search + readinessHashFragment());
        } else {
          window.location.hash = readinessHashFragment().slice(1);
        }
      } catch (err) { /* best effort */ }
    }
    // Trace sub-tab (FBS-208, AC-209-1/-3/-6): the active entity is the
    // pivot; fetch + render when the sub activates.
    if (sub === 'trace') {
      activateTraceSubView();
    }
    // Blocking sub-tab filter: carry the stage= param into the FilterBar
    // and apply so a verdict-grid failing-count link lands on a filtered
    // view. The persona= param is accepted on the same shape.
    if (sub === 'blocking') {
      var stage = '';
      var persona = '';
      try { if (params && params.stage) stage = decodeURIComponent(params.stage); } catch (e) { stage = ''; }
      try { if (params && params.persona) persona = decodeURIComponent(params.persona); } catch (e) { persona = ''; }
      var bar = document.querySelector('[data-rcf-filterbar="readiness-blocking"]');
      if (bar) {
        var stageSel = bar.querySelector('[data-filter-key="stage"]');
        var personaSel = bar.querySelector('[data-filter-key="persona"]');
        if (stageSel) stageSel.value = stage;
        if (personaSel) personaSel.value = persona;
        applyReadinessBlockingFilter(bar.parentNode);
      }
    }
  }

  function wireReadinessSubTabStrip() {
    var strip = readinessSubTabStrip();
    if (!strip || strip.__rcfReadinessSubWired) return;
    strip.__rcfReadinessSubWired = true;
    var btns = strip.querySelectorAll('[role="tab"]');
    for (var i = 0; i < btns.length; i += 1) {
      btns[i].addEventListener('click', function (ev) {
        ev.preventDefault && ev.preventDefault();
        var sub = ev.currentTarget.getAttribute('data-sub');
        if (!sub) return;
        activateReadinessSub(sub);
        writeReadinessHash();
      });
    }
  }


  // ---- Trace matrix (FBS-208, TAC-4136, ADR-4140, AC-209-1..7) --------
  //
  // The Readiness Trace sub-view fetches `./trace.json?id=<pivot>` and
  // `./coverage.json?scope=<reqId>` and renders the matrix into
  // `[data-rcf-trace-root]`. Results are kept in a page-lifetime Map
  // keyed by `${version}:${pivot}` (AC-209-4): a tree-update swap
  // invalidates nothing in the cache but marks the current render as
  // stale until the next fetch completes. The empty state offers the
  // lookup modal (AC-209-6). On >200 rows a client-side row filter
  // appears (AC-209-7); the full row set is retained in memory.

  var TRACE_CACHE = Object.create(null);
  var TRACE_INFLIGHT = Object.create(null);
  var TRACE_RENDERED_PIVOT = null;
  var TRACE_LAST_RENDER_VERSION = 0;
  var TRACE_STALE = false;

  function traceRoot() {
    return document.querySelector('[data-rcf-trace-root]');
  }

  function traceVersion() {
    // live-client publishes the current version on window.__rcfTreeVersion
    // after every tree-update; before the first SSE event the first-paint
    // version is treated as 1.
    var v = window.__rcfTreeVersion;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    return 1;
  }

  function traceCacheKey(version, pivot) {
    return version + ':' + pivot;
  }

  function traceEntityFromHash() {
    try {
      var h = (window.location.hash || '').replace(/^#/, '');
      var params = parseHashParams(h);
      if (!params) return '';
      if (params.tab !== 'readiness' || params.sub !== 'trace') return '';
      return params.entity ? decodeURIComponent(params.entity) : '';
    } catch (e) { return ''; }
  }

  function parseHashParams(raw) {
    if (!raw) return null;
    var out = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var p = parts[i];
      var eq = p.indexOf('=');
      if (eq === -1) { out[p] = ''; continue; }
      out[p.slice(0, eq)] = p.slice(eq + 1);
    }
    return out;
  }

  function fetchJson(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var ok = xhr.status >= 200 && xhr.status < 300;
      var parsed = null;
      if (ok) {
        try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
      }
      cb(ok, parsed, xhr.status);
    };
    try { xhr.send(); } catch (e) { cb(false, null, 0); }
  }

  function reqOwnerOf(pivot) {
    // The Coverage route takes an optional scope that must be a PRD /
    // REQ / US. For an AC pivot the row's REQ is the valid narrow
    // scope; for a US pivot the US is valid. For a REQ pivot the REQ
    // itself. For other kinds (TS/TC/FBS/CN/TAC/ADR) we omit scope
    // (tree-wide coverage). Only the AC+US+REQ prefix check is run
    // here, which keeps the compute small on a REQ-scoped pivot.
    if (typeof pivot !== 'string') return '';
    if (/^REQ-/.test(pivot)) return pivot;
    if (/^US-/.test(pivot) || /^AC-/.test(pivot)) return '';
    return '';
  }

  // FBS-208 FINALISE (P2-5): the matrix pivots on upstream nodes
  // (REQ/US/AC). A downstream pivot (TS/TC/FBS/CN/TAC/ADR) returns
  // zero rows and would show a silent empty table; render an
  // explanatory state and offer the lookup instead.
  function isDownstreamPivot(pivot) {
    if (typeof pivot !== 'string') return false;
    return /^(TS-|TC-|FBS-|CN-|TAC-|ADR-)/.test(pivot);
  }

  // FBS-208 FINALISE (P1-1): on a tree-version swap the new cache key
  // misses; look up the most recent prior-version entry for the same
  // pivot so the previous render stays visible with the stale banner
  // while the fetch runs. The cache keys are `${version}:${pivot}`.
  function findPriorCachedEntry(pivot, currentVersion) {
    var best = null;
    var bestVersion = -1;
    for (var k in TRACE_CACHE) {
      if (!Object.prototype.hasOwnProperty.call(TRACE_CACHE, k)) continue;
      var idx = k.indexOf(':');
      if (idx === -1) continue;
      var ver = Number(k.slice(0, idx));
      var piv = k.slice(idx + 1);
      if (piv !== pivot) continue;
      if (!Number.isFinite(ver)) continue;
      if (ver >= currentVersion) continue;
      if (ver > bestVersion) { bestVersion = ver; best = TRACE_CACHE[k]; }
    }
    return best;
  }

  function renderTraceRoot(pivot, trace, coverage, opts) {
    var root = traceRoot();
    if (!root) return;
    opts = opts || {};
    var kind;
    if (opts.unavailable) kind = 'unavailable';
    else if (trace && trace.found === false) kind = 'unknown';
    else if (trace) kind = 'ok';
    else kind = 'shell';
    var staleAttr = opts.stale ? ' data-rcf-trace-stale="yes"' : '';
    var pivotLabel = pivot ? escapeAttr(pivot) : '';
    if (!pivot) {
      root.innerHTML = emptyStateHtml({ reason: 'no-pivot' });
      TRACE_RENDERED_PIVOT = '';
      TRACE_STALE = false;
      return;
    }
    if (kind === 'unknown') {
      root.innerHTML = emptyStateHtml({ reason: 'unknown-pivot', pivot: pivotLabel });
      TRACE_RENDERED_PIVOT = pivot;
      TRACE_STALE = false;
      return;
    }
    if (kind === 'unavailable') {
      // FBS-208 FINALISE (P2-6): a 5xx or network error is NOT the
      // same as 'unknown-pivot'; the chain may still carry the id.
      // Render a trace-unavailable state and keep the pivot visible.
      root.innerHTML = '<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="unavailable" data-rcf-trace-reason="fetch-error" data-rcf-pivot="' + pivotLabel + '" aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace unavailable for ' + pivotLabel + '</h3></header><p>The trace service did not respond. Try again or pick another id.</p><p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p></section>';
      TRACE_RENDERED_PIVOT = pivot;
      TRACE_STALE = false;
      return;
    }
    if (kind === 'shell') {
      root.innerHTML = '<section class="rcf-trace-matrix" data-rcf-trace-matrix="shell" data-rcf-pivot="' + pivotLabel + '"' + staleAttr + ' aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace matrix for ' + pivotLabel + '</h3></header><p class="muted">Loading trace for ' + pivotLabel + '...</p></section>';
      TRACE_RENDERED_PIVOT = pivot;
      TRACE_LAST_RENDER_VERSION = traceVersion();
      return;
    }
    // FBS-208 FINALISE (P2-5): a TS/TC/FBS/CN/TAC/ADR pivot has no
    // upstream US/AC rows, so the matrix would be silently empty.
    // Render an explanatory state instead and offer the lookup.
    if (isDownstreamPivot(pivot)) {
      root.innerHTML = '<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="downstream" data-rcf-trace-reason="downstream-pivot" data-rcf-pivot="' + pivotLabel + '" aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">No upstream rows for ' + pivotLabel + '</h3></header><p>The matrix pivots on a requirement, story or criterion. Pick an upstream id that reaches <code>' + pivotLabel + '</code>.</p><p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p></section>';
      TRACE_RENDERED_PIVOT = pivot;
      TRACE_LAST_RENDER_VERSION = traceVersion();
      TRACE_STALE = false;
      return;
    }
    // Full render from the client build helper.
    try {
      var rows = buildMatrixRowsFromPayload(trace, coverage);
      root.innerHTML = renderMatrixHtml(pivot, rows, opts.stale);
      TRACE_RENDERED_PIVOT = pivot;
      TRACE_LAST_RENDER_VERSION = traceVersion();
      TRACE_STALE = Boolean(opts.stale);
    } catch (e) {
      root.innerHTML = '<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="error" aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace unavailable</h3></header><p>The trace response could not be rendered. Try again or pick another id.</p></section>';
    }
  }

  function emptyStateHtml(args) {
    var reason = args.reason;
    var pivot = args.pivot || '';
    var heading = reason === 'unknown-pivot' && pivot
      ? 'No trace for ' + pivot
      : 'Pick an id to trace';
    var body = reason === 'unknown-pivot'
      ? '<p>The id <code>' + pivot + '</code> is not in the current tree.</p>'
        + '<p>Pick another id below.</p>'
        + '<p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p>'
      : '<p>Pick a requirement, story or criterion through the Trace action on any readiness row, or open the lookup to search by id.</p>'
        + '<p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p>';
    var pivotAttr = pivot ? ' data-rcf-pivot="' + pivot + '"' : '';
    return '<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="empty" data-rcf-trace-reason="' + reason + '"' + pivotAttr + ' aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">' + heading + '</h3></header>' + body + '</section>';
  }

  var TRACE_COL_LABEL = { ts: 'Suites', tc: 'Cases', fbs: 'Build specs', cn: 'Components' };

  function buildMatrixRowsFromPayload(trace, coverage) {
    if (!trace || !trace.found || !Array.isArray(trace.nodes) || !Array.isArray(trace.edges)) return [];
    var nodes = trace.nodes;
    var edges = trace.edges;
    var byId = {};
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      if (n && typeof n.id === 'string' && typeof n.kind === 'string') byId[n.id] = n;
    }
    var outFromId = {};
    for (var j = 0; j < edges.length; j += 1) {
      var e = edges[j];
      if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
      if (!outFromId[e.from]) outFromId[e.from] = [];
      outFromId[e.from].push(e.to);
    }
    function reachFrom(id) {
      // FBS-208 FINALISE (P2-4): an AC's Cases column must list only
      // the AC's OWN test cases, not every sibling TC the AC's TS also
      // contains. Stop traversal at a TS boundary: TS is recorded in
      // the bucket but we do not descend into its children. TC still
      // reaches via the AC's direct testPointer edges (AC->TC).
      var bucket = { ts: [], tc: [], fbs: [], cn: [] };
      var seen = {}; seen[id] = true;
      var stack = [id];
      while (stack.length > 0) {
        var cur = stack.pop();
        var curKind = byId[cur] && byId[cur].kind;
        if (curKind === 'ts' || curKind === 'testSuite') continue;
        var kids = outFromId[cur] || [];
        for (var k = 0; k < kids.length; k += 1) {
          var to = kids[k];
          if (seen[to]) continue; seen[to] = true;
          var kind = byId[to] && byId[to].kind;
          if (kind === 'ts' || kind === 'testSuite') bucket.ts.push(to);
          else if (kind === 'tc' || kind === 'testCase') bucket.tc.push(to);
          else if (kind === 'fbs') bucket.fbs.push(to);
          else if (kind === 'cn' || kind === 'codeNode') bucket.cn.push(to);
          stack.push(to);
        }
      }
      for (var kk in bucket) {
        if (!Object.prototype.hasOwnProperty.call(bucket, kk)) continue;
        bucket[kk] = Array.from(new Set(bucket[kk])).sort();
      }
      return bucket;
    }
    var acCov = {};
    if (coverage && Array.isArray(coverage.requirements)) {
      for (var ri = 0; ri < coverage.requirements.length; ri += 1) {
        var req = coverage.requirements[ri];
        var acs = (req && req.acs) || [];
        for (var ai = 0; ai < acs.length; ai += 1) {
          var ac = acs[ai];
          if (ac && typeof ac.id === 'string') acCov[ac.id] = ac;
        }
      }
    }
    var usRows = [];
    var acsByUs = {};
    var standaloneAcs = [];
    for (var ni = 0; ni < nodes.length; ni += 1) {
      var nn = nodes[ni];
      if (nn.kind === 'userStory' || nn.kind === 'us') { usRows.push(nn); acsByUs[nn.id] = []; }
    }
    for (var ni2 = 0; ni2 < nodes.length; ni2 += 1) {
      var mm = nodes[ni2]; if (mm.kind !== 'ac') continue;
      var parentUs = null;
      for (var ei = 0; ei < edges.length; ei += 1) {
        var ee = edges[ei];
        if (ee.to === mm.id && ee.kind === 'parentChild') {
          var pp = byId[ee.from];
          if (pp && (pp.kind === 'userStory' || pp.kind === 'us')) { parentUs = pp.id; break; }
        }
      }
      if (parentUs && acsByUs[parentUs]) acsByUs[parentUs].push(mm);
      else standaloneAcs.push(mm);
    }
    function resolutionFor(acId, kindKey, ids) {
      if (!ids || ids.length === 0) return 'none';
      if (kindKey !== 'tc') return 'resolving';
      var cov = acCov[acId];
      if (!cov) return 'unresolved';
      var resolvedSet = {}; (cov.testCases || []).forEach(function (x) { resolvedSet[x] = true; });
      var unresolvedSet = {}; (cov.unresolvedTestCases || []).forEach(function (x) { unresolvedSet[x] = true; });
      var hasUnres = false, hasRes = false;
      for (var ii = 0; ii < ids.length; ii += 1) {
        var id = ids[ii];
        if (unresolvedSet[id]) hasUnres = true;
        else if (resolvedSet[id]) hasRes = true;
      }
      if (hasUnres) return 'unresolved';
      if (hasRes) return 'resolving';
      return 'none';
    }
    function acRow(ac, parentUsId) {
      var r = reachFrom(ac.id);
      return {
        id: ac.id, kind: 'ac', title: ac.title || '', parent: parentUsId || '',
        cells: ['ts', 'tc', 'fbs', 'cn'].map(function (k) {
          return { kind: k, reached: r[k].length > 0, resolution: resolutionFor(ac.id, k, r[k]), ids: r[k] };
        }),
      };
    }
    function usRow(us, acsUnder) {
      var u = { ts: {}, tc: {}, fbs: {}, cn: {} };
      acsUnder.forEach(function (a) {
        var r = reachFrom(a.id);
        ['ts', 'tc', 'fbs', 'cn'].forEach(function (k) { r[k].forEach(function (v) { u[k][v] = true; }); });
      });
      var bucket = { ts: Object.keys(u.ts).sort(), tc: Object.keys(u.tc).sort(), fbs: Object.keys(u.fbs).sort(), cn: Object.keys(u.cn).sort() };
      var anyAcUnres = acsUnder.some(function (a) { var c = acCov[a.id]; return c ? c.covered !== true : bucket.tc.length > 0; });
      return {
        id: us.id, kind: 'us', title: us.title || '', parent: '',
        cells: ['ts', 'tc', 'fbs', 'cn'].map(function (k) {
          var res = k === 'tc' ? (bucket.tc.length === 0 ? 'none' : (anyAcUnres ? 'unresolved' : 'resolving')) : (bucket[k].length === 0 ? 'none' : 'resolving');
          return { kind: k, reached: bucket[k].length > 0, resolution: res, ids: bucket[k] };
        }),
      };
    }
    var rows = [];
    for (var ui = 0; ui < usRows.length; ui += 1) {
      var u2 = usRows[ui]; var ks = acsByUs[u2.id] || [];
      rows.push(usRow(u2, ks));
      for (var k2 = 0; k2 < ks.length; k2 += 1) rows.push(acRow(ks[k2], u2.id));
    }
    for (var s = 0; s < standaloneAcs.length; s += 1) rows.push(acRow(standaloneAcs[s], ''));
    return rows;
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMatrixHtml(pivot, rows, stale) {
    var filterBar = rows.length > 200
      ? '<div class="rcf-trace-matrix__filter" data-rcf-filterbar="trace-matrix" role="search"><label><span>Filter rows (story id or criterion id)</span><input type="search" data-rcf-filter-key="rowId" placeholder="e.g. US-209 or AC-209-3"></label></div>'
      : '';
    var staleBanner = stale
      ? '<p class="rcf-trace-matrix__stale muted small" data-rcf-trace-stale="yes">Tree changed. The matrix below reflects the previous version; a fresh trace is being fetched.</p>'
      : '';
    var head = '<thead><tr><th scope="col" data-rcf-col="row">Story / criterion</th><th scope="col" data-rcf-col="ts" data-rcf-trace-col="ts">Suites</th><th scope="col" data-rcf-col="tc" data-rcf-trace-col="tc">Cases</th><th scope="col" data-rcf-col="fbs" data-rcf-trace-col="fbs">Build specs</th><th scope="col" data-rcf-col="cn" data-rcf-trace-col="cn">Components</th></tr></thead>';
    var body = rows.map(function (r) {
      var kindAttr = r.kind === 'us' ? 'us' : 'ac';
      var parentAttr = r.parent ? ' data-rcf-parent="' + escapeAttr(r.parent) + '"' : '';
      var titleLabel = r.title ? ' <span class="rcf-trace-matrix__row-title muted small">' + escapeAttr(r.title) + '</span>' : '';
      var idLink = '<a href="#' + escapeAttr(r.id) + '" data-rcf-trace-row-id="' + escapeAttr(r.id) + '">' + escapeAttr(r.id) + '</a>';
      var cells = r.cells.map(function (c) {
        var label = c.ids.length === 0
          ? '<span class="rcf-sr-only">' + (c.reached ? 'reached' : 'not reached') + '</span>'
          : '<span class="rcf-trace-matrix__cell-ids" data-rcf-cell-ids="' + escapeAttr(c.ids.join(',')) + '">' + escapeAttr(c.ids.length === 1 ? c.ids[0] : c.ids.length + ' ids') + '</span>';
        return '<td data-rcf-col="' + c.kind + '" data-rcf-trace-col="' + c.kind + '" data-rcf-cell-reach="' + (c.reached ? 'yes' : 'no') + '" data-rcf-cell-resolution="' + c.resolution + '" title="' + escapeAttr((TRACE_COL_LABEL[c.kind] || c.kind) + ': ' + (c.reached ? 'reached' : 'not reached') + ', resolution ' + c.resolution) + '">' + label + '</td>';
      }).join('');
      return '<tr data-rcf-row-id="' + escapeAttr(r.id) + '" data-rcf-row-kind="' + kindAttr + '"' + parentAttr + '><th scope="row" data-rcf-col="row">' + idLink + titleLabel + '</th>' + cells + '</tr>';
    }).join('');
    return '<section class="rcf-trace-matrix" data-rcf-trace-matrix="yes" data-rcf-pivot="' + escapeAttr(pivot) + '" aria-labelledby="rcf-readiness-trace-heading"><header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace matrix for ' + escapeAttr(pivot) + '</h3> <span class="rcf-badge rcf-badge--count">' + rows.length + '</span></header>' + staleBanner + filterBar + '<table class="rcf-trace-matrix__table" aria-describedby="rcf-readiness-trace-heading">' + head + '<tbody>' + body + '</tbody></table></section>';
  }

  function fetchAndRenderTrace(pivot) {
    if (!pivot) { renderTraceRoot('', null, null, {}); return; }
    var v = traceVersion();
    var key = traceCacheKey(v, pivot);
    var cached = TRACE_CACHE[key];
    if (cached && cached.trace) {
      renderTraceRoot(pivot, cached.trace, cached.coverage || null, { stale: false });
      return;
    }
    if (TRACE_INFLIGHT[key]) return;
    TRACE_INFLIGHT[key] = true;
    // FBS-208 FINALISE (P1-1): on a tree-version swap the cache for
    // the new version misses. Look up a prior-version entry for the
    // same pivot and render it as stale while we fetch; the user sees
    // the previous matrix with a stale banner, not an empty shell.
    var prior = findPriorCachedEntry(pivot, v);
    if (prior && prior.trace) {
      renderTraceRoot(pivot, prior.trace, prior.coverage || null, { stale: true });
    } else {
      renderTraceRoot(pivot, null, null, { stale: TRACE_STALE });
    }
    var traceUrl = './trace.json?id=' + encodeURIComponent(pivot) + '&direction=forward&includeCode=1';
    fetchJson(traceUrl, function (ok, parsed, status) {
      // FBS-208 FINALISE (P2-6, stale-response guard): a hash change
      // since the fetch started means another pivot owns the view;
      // drop this callback's render.
      if (traceEntityFromHash() !== pivot) {
        TRACE_INFLIGHT[key] = false;
        return;
      }
      if (!ok || !parsed) {
        TRACE_INFLIGHT[key] = false;
        // FBS-208 FINALISE (P2-6): distinguish a 404 (unknown-pivot,
        // the id is not in the tree) from any other failure (service
        // unavailable, parse error, network). Only a 404 renders the
        // 'id not in current tree' empty-state.
        if (status === 404) {
          renderTraceRoot(pivot, { found: false, pivot: pivot }, null, {});
        } else {
          renderTraceRoot(pivot, null, null, { unavailable: true });
        }
        return;
      }
      if (parsed.found === false) {
        TRACE_INFLIGHT[key] = false;
        TRACE_CACHE[key] = { trace: parsed, coverage: null };
        renderTraceRoot(pivot, parsed, null, {});
        return;
      }
      var scope = reqOwnerOf(pivot);
      var covUrl = './coverage.json' + (scope ? '?scope=' + encodeURIComponent(scope) : '');
      fetchJson(covUrl, function (okCov, parsedCov) {
        TRACE_INFLIGHT[key] = false;
        // Stale-response guard again on the inner fetch.
        if (traceEntityFromHash() !== pivot) return;
        TRACE_CACHE[key] = { trace: parsed, coverage: okCov ? parsedCov : null };
        renderTraceRoot(pivot, parsed, okCov ? parsedCov : null, { stale: false });
      });
    });
  }

  // Called from applyReadinessHash when sub=trace activates, and after an
  // SSE swap when the Trace sub-tab is already active.
  function activateTraceSubView() {
    var pivot = traceEntityFromHash();
    fetchAndRenderTrace(pivot);
  }

  // AC-209-4: on an SSE swap `rcfPage.init()` is invoked. We mark the
  // current render stale when the version changed and refetch; the
  // previous render stays visible with the stale banner until the new
  // bytes arrive.
  function maybeRefetchTraceAfterSse() {
    if (TRACE_RENDERED_PIVOT === null) return;
    var v = traceVersion();
    if (v === TRACE_LAST_RENDER_VERSION) return;
    TRACE_STALE = true;
    var root = traceRoot();
    if (root) {
      // Prepend the stale banner to the existing render.
      var head = root.querySelector('.rcf-trace-matrix__head');
      if (head && !root.querySelector('[data-rcf-trace-stale]')) {
        var p = document.createElement('p');
        p.className = 'rcf-trace-matrix__stale muted small';
        p.setAttribute('data-rcf-trace-stale', 'yes');
        p.textContent = 'Tree changed. The matrix below reflects the previous version; a fresh trace is being fetched.';
        head.parentNode.insertBefore(p, head.nextSibling);
      }
    }
    var pivot = TRACE_RENDERED_PIVOT;
    if (pivot) fetchAndRenderTrace(pivot);
  }

  function wireTraceMatrix() {
    var root = traceRoot();
    if (!root) return;
    if (root.__rcfTraceWired) {
      // Still re-check: an SSE swap re-invokes onReady, which should
      // re-fetch when the version has changed (AC-209-4).
      maybeRefetchTraceAfterSse();
      // Also render if the sub-tab is currently active and the hash
      // changed to a new entity while we were already wired.
      var panel = readinessSubPanel('trace');
      if (panel && !panel.hasAttribute('hidden')) activateTraceSubView();
      return;
    }
    root.__rcfTraceWired = true;
    // Click delegation for "Open the lookup" buttons in the empty state.
    root.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== root) {
        if (el.getAttribute && el.getAttribute('data-rcf-trace-open-lookup') === 'yes') {
          ev.preventDefault && ev.preventDefault();
          try { lookupOpen(); } catch (e) { /* soft */ }
          return;
        }
        el = el.parentNode;
      }
    });
    // Row filter (AC-209-7).
    root.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!input || !input.getAttribute) return;
      if (input.getAttribute('data-rcf-filter-key') !== 'rowId') return;
      var q = (input.value || '').trim().toLowerCase();
      var rows = root.querySelectorAll('tr[data-rcf-row-id]');
      for (var i = 0; i < rows.length; i += 1) {
        var r = rows[i];
        var id = (r.getAttribute('data-rcf-row-id') || '').toLowerCase();
        var parent = (r.getAttribute('data-rcf-parent') || '').toLowerCase();
        var match = q === '' || id.indexOf(q) !== -1 || parent.indexOf(q) !== -1;
        if (match) r.removeAttribute('hidden');
        else r.setAttribute('hidden', '');
      }
    });
    activateTraceSubView();
  }

  // AC-205-5: a mount URL of `?tab=requirements&entity=US-304` lands on the
  // same position at first paint. The hash-router owns tab + entity, so we
  // promote the tab/sub/entity query params into the hash fragment at boot
  // when no explicit hash is already set. embed/theme stay in the query so
  // urlWithHash keeps the Dex contract.
  function bootHashFromQuery() {
    if (window.location.hash) return;
    var q = parseQuery(window.location.search);
    var parts = [];
    if (q.tab) parts.push('tab=' + encodeURIComponent(q.tab));
    if (q.sub) parts.push('sub=' + encodeURIComponent(q.sub));
    if (q.entity) parts.push('entity=' + encodeURIComponent(q.entity));
    if (parts.length === 0) return;
    try {
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + parts.join('&'));
      } else {
        window.location.hash = parts.join('&');
      }
    } catch (err) { /* best effort; resolveHash will no-op on empty hash */ }
  }

  // FBS-204 (TAC-4135 AC-18003-5): Copy for your agent handles.
  //
  // Each questions-table row carries one `[data-rcf-copy-for]` button
  // and a `data-rcf-copy-text` attribute holding one line: `<itemId>:
  // <ask>` (no command text; AC-18003-7). The button copies that line
  // to the clipboard and fires the shared toast helper. The handler is
  // idempotent across SSE swaps via the __rcfCopyWired sentinel.
  function wireReadinessCopyHandles() {
    var buttons = document.querySelectorAll('[data-rcf-copy-for]');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      if (btn.__rcfCopyWired) continue;
      btn.__rcfCopyWired = true;
      btn.addEventListener('click', function (ev) {
        var target = ev.currentTarget;
        var text = target.getAttribute('data-rcf-copy-text') || '';
        copyToClipboardOrFallback(text, function (ok) {
          var msg = ok ? 'Copied for your agent.' : 'Could not copy; the text stays on the page.';
          try { showToast(msg); } catch (e) { /* no toast node */ }
        });
      });
    }
  }

  // FBS-204 (TAC-4135 AC-18003-1): sortable columns on the questions
  // table. Every header with `data-rcf-sortable="yes"` becomes a
  // keyboard-reachable button that sorts the table's tbody rows by
  // the matching `data-rcf-col` cell. Toggles ascending / descending;
  // clears the other headers' aria-sort. Idempotent across SSE swaps
  // via a __rcfSortWired sentinel. No external deps, no CSS beyond
  // aria-sort which the stylesheet already respects.
  function wireReadinessSortableHeaders() {
    var headers = document.querySelectorAll('table.rcf-cmd-table__table th[data-rcf-sortable="yes"]');
    for (var i = 0; i < headers.length; i += 1) {
      var th = headers[i];
      if (th.__rcfSortWired) continue;
      th.__rcfSortWired = true;
      th.setAttribute('role', 'button');
      if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');
      th.addEventListener('click', function (ev) { sortTableByHeader(ev.currentTarget); });
      th.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          sortTableByHeader(ev.currentTarget);
        }
      });
    }
  }

  function sortTableByHeader(th) {
    var table = th && th.closest ? th.closest('table.rcf-cmd-table__table') : null;
    if (!table) return;
    var col = th.getAttribute('data-rcf-col');
    if (!col) return;
    var current = th.getAttribute('aria-sort');
    var dir = current === 'ascending' ? 'descending' : 'ascending';
    var peers = table.querySelectorAll('th[data-rcf-sortable="yes"]');
    for (var i = 0; i < peers.length; i += 1) peers[i].removeAttribute('aria-sort');
    th.setAttribute('aria-sort', dir);
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    var rows = [];
    for (var r = 0; r < tbody.children.length; r += 1) {
      if (tbody.children[r].tagName && tbody.children[r].tagName.toLowerCase() === 'tr') {
        rows.push(tbody.children[r]);
      }
    }
    var isNumeric = col === 'number';
    rows.sort(function (a, b) {
      var ac = a.querySelector('td[data-rcf-col="' + col + '"]');
      var bc = b.querySelector('td[data-rcf-col="' + col + '"]');
      var av = ac ? (ac.textContent || '').trim() : '';
      var bv = bc ? (bc.textContent || '').trim() : '';
      if (isNumeric) {
        var an = Number(av); var bn = Number(bv);
        return dir === 'ascending' ? (an - bn) : (bn - an);
      }
      return dir === 'ascending' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    for (var j = 0; j < rows.length; j += 1) tbody.appendChild(rows[j]);
  }

  // Copy helper that prefers navigator.clipboard and falls back to a
  // transient textarea + document.execCommand for older browsers and
  // embedded contexts without the Permissions API grant.
  function copyToClipboardOrFallback(text, cb) {
    var done = typeof cb === 'function' ? cb : function () {};
    var val = text == null ? '' : String(text);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(val).then(function () { done(true); }, function () { done(fallbackCopy(val)); });
        return;
      }
    } catch (e) { /* fall through to the textarea path */ }
    done(fallbackCopy(val));
  }

  function fallbackCopy(val) {
    try {
      var ta = document.createElement('textarea');
      ta.value = val;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch (e) { return false; }
  }

  function onReady() {
    initShellFromQuery();
    bootHashFromQuery();
    wireThemeMessages();
    initMermaid();
    wireTabs();
    wireProductMap();
    wireRequirementsFilterBar();
    wireArchitectureFilterBars();
    wireBuildTab();
    wireEntitySelectors();
    wireFixturePage();
    wireLookup();
    wireStageLegend();
    wireReadinessCopyHandles();
    wireReadinessSortableHeaders();
    wireReadinessBlockingFilterBar();
    wireTraceMatrix();
    wireReadinessSubTabStrip();
    resolveHash(window.location.hash);
    if (!hashchangeWired) {
      hashchangeWired = true;
      window.addEventListener('hashchange', function () {
        resolveHash(window.location.hash);
      });
    }
  }

  // FBS-204 (TAC-4135 AC-18003-3): the blocking table's FilterBar
  // (`data-rcf-filterbar="readiness-blocking"`) carries two <select>s
  // (stage, persona). Changing either hides rows that do not match.
  // Rows carry [data-rcf-stage] and [data-rcf-persona]; the renderer
  // persists the initial selection as a `selected` option so the
  // hash-driven first paint survives.
  function wireReadinessBlockingFilterBar() {
    var bars = document.querySelectorAll('[data-rcf-filterbar="readiness-blocking"]');
    for (var i = 0; i < bars.length; i += 1) {
      var bar = bars[i];
      if (bar.__rcfBlockingBarWired) continue;
      bar.__rcfBlockingBarWired = true;
      bar.addEventListener('change', function (ev) {
        var b = ev.currentTarget;
        var table = b.parentNode;
        if (!table) return;
        applyReadinessBlockingFilter(table);
      });
      applyReadinessBlockingFilter(bar.parentNode);
    }
  }

  function applyReadinessBlockingFilter(table) {
    if (!table) return;
    var bar = table.querySelector('[data-rcf-filterbar="readiness-blocking"]');
    if (!bar) return;
    var stageSel = bar.querySelector('[data-filter-key="stage"]');
    var personaSel = bar.querySelector('[data-filter-key="persona"]');
    var stage = stageSel ? stageSel.value : '';
    var persona = personaSel ? personaSel.value : '';
    var rows = table.querySelectorAll('tbody tr[data-rcf-stage], tbody tr[data-rcf-persona]');
    for (var i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      var okStage = !stage || r.getAttribute('data-rcf-stage') === stage;
      var okPersona = !persona || r.getAttribute('data-rcf-persona') === persona;
      if (okStage && okPersona) r.removeAttribute('hidden');
      else r.setAttribute('hidden', '');
    }
  }

  window.rcfPage = window.rcfPage || {};
  window.rcfPage.init = onReady;
  // Shared helpers available for later tabs to call. The toast helper
  // is the one the fixture page demos; later PRs reuse it for the
  // ID-lookup copy-id confirmation and the DAG inspector "linked"
  // acknowledgement.
  window.rcfView = window.rcfView || {};
  window.rcfView.showToast = showToast;
  // FBS-208 FINALISE: client-path internals exposed for behavioural
  // tests. The server-side `src/view/readiness/trace-matrix.js`
  // module is a spec-by-example; the shipped behaviour is this IIFE's
  // inline implementation. Tests use these to prove the two paths
  // match (parity) and to probe cache / downstream-pivot behaviour.
  // No production code paths read these; they are a test seam only.
  window.rcfTraceInternals = {
    buildMatrixRowsFromPayload: buildMatrixRowsFromPayload,
    renderMatrixHtml: renderMatrixHtml,
    isDownstreamPivot: isDownstreamPivot,
    findPriorCachedEntry: findPriorCachedEntry,
    traceCacheKey: traceCacheKey,
    cache: TRACE_CACHE,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
