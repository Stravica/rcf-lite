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

  function initShellFromQuery() {
    var q = parseQuery(window.location.search);
    // theme: explicit light|dark wins, auto falls through to the
    // :root:not([data-theme]) + @media prefers-color-scheme block in
    // style.css. Absent stays light (the base :root tokens).
    var theme = q.theme;
    if (theme === 'light' || theme === 'dark' || theme === 'auto') applyTheme(theme === 'auto' ? null : theme);
    // embed: any value other than exactly "1" is ignored.
    applyEmbed(q.embed === '1');
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
      if (data.theme === 'light' || data.theme === 'dark') applyTheme(data.theme);
    });
  }

  // ---- hash parsing + preservation --------------------------------------

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
        var entTarget = findByDocId(kv.entity);
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
        // #tab=requirements&entity=REQ-002 opens the entity in place.
        if (params.entity) {
          var ent = findByDocId(params.entity);
          if (ent) {
            openAncestorDetails(ent);
            if (ent.tagName && ent.tagName.toLowerCase() === 'details') ent.open = true;
            try { ent.scrollIntoView({ block: 'start' }); } catch (e) { ent.scrollIntoView(); }
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
        applyTheme(mode === 'auto' ? null : mode);
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
    return '#' + parts.join('&');
  }

  function writeRequirementsHash() {
    var state = readRequirementsFilterState();
    if (!state) return;
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

  // ---- EntitySelector (viewer UI refresh PR 3, decision 4) -----

  function parseEntitySelectorPayload(root) {
    var dataNode = root.querySelector('script.rcf-entity-selector-data');
    if (!dataNode) return [];
    try { return JSON.parse(dataNode.textContent || '[]'); }
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

  var hashchangeWired = false;
  function onReady() {
    initShellFromQuery();
    wireThemeMessages();
    initMermaid();
    wireTabs();
    wireProductMap();
    wireRequirementsFilterBar();
    wireEntitySelectors();
    wireFixturePage();
    resolveHash(window.location.hash);
    if (!hashchangeWired) {
      hashchangeWired = true;
      window.addEventListener('hashchange', function () {
        resolveHash(window.location.hash);
      });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
