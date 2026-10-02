// Wespa host fixture client (viewer UI refresh PR 9; TAC-4134).
// Served at /test-host.js by the viewer's dev server when --test-host
// is on (RCF_VIEW_TEST_HOST=1 equivalent). Wires three fixture
// behaviours:
//   - Theme toggle: posts { type: "rcf-view-theme", theme } to the
//     iframe.contentWindow, targeting window.location.origin so a
//     cross-origin receiver would refuse the message. Does not read
//     event.origin itself; the viewer does, and the fixture READS the
//     iframe's data-theme attribute as evidence.
//   - Sidebar drag: a 6px handle on the sidebar's right edge sets
//     --wespa-sidebar-width on the <main> grid; clamped to 64..400 px
//     live.
//   - Collapse/Expand: snaps the sidebar between 64 px (collapsed) and
//     200 px (expanded) and toggles the .collapsed class.
//
// Does NOT persist theme or sidebar width to localStorage (ADR-4136):
// a passing run has to flip the iframe through postMessage, which is
// the invariant the fixture pins.
//
// Classic (non-module) browser script so the fixture page carries no
// inline <script> and the embed-client is a plain <script src>.

(function () {
  var SIDEBAR_MIN = 64;
  var SIDEBAR_EXPANDED = 200;
  var SIDEBAR_MAX = 400;

  function iframe() {
    return document.getElementById('rcf-test-host-iframe');
  }

  function postThemeToIframe(theme) {
    var el = iframe();
    if (!el || !el.contentWindow) return;
    try {
      el.contentWindow.postMessage(
        { type: 'rcf-view-theme', theme: theme },
        window.location.origin,
      );
    } catch (e) { /* swallow */ }
  }

  function wireThemeToggle() {
    var buttons = Array.prototype.slice.call(
      document.querySelectorAll('[data-rcf-host-theme]'),
    );
    if (buttons.length === 0) return;
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var theme = btn.getAttribute('data-rcf-host-theme');
        if (theme !== 'light' && theme !== 'dark') return;
        buttons.forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        postThemeToIframe(theme);
      });
    });
  }

  function setSidebarWidth(px) {
    var shell = document.querySelector('main.wespa-shell');
    if (!shell) return;
    var clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
    shell.style.setProperty('--wespa-sidebar-width', clamped + 'px');
    var aside = document.querySelector('[data-rcf-host-sidebar]');
    if (aside) {
      if (clamped <= SIDEBAR_MIN) aside.classList.add('collapsed');
      else aside.classList.remove('collapsed');
    }
  }

  function wireSidebarDrag() {
    var handle = document.querySelector('[data-rcf-host-sidebar-drag]');
    var aside = document.querySelector('[data-rcf-host-sidebar]');
    if (!handle || !aside) return;
    var dragging = false;
    handle.addEventListener('mousedown', function (ev) {
      dragging = true;
      handle.classList.add('dragging');
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      var rect = aside.getBoundingClientRect();
      setSidebarWidth(ev.clientX - rect.left);
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
    });
  }

  function wireSidebarToggle() {
    var btn = document.querySelector('[data-rcf-host-sidebar-toggle]');
    var aside = document.querySelector('[data-rcf-host-sidebar]');
    if (!btn || !aside) return;
    btn.addEventListener('click', function () {
      if (aside.classList.contains('collapsed')) {
        setSidebarWidth(SIDEBAR_EXPANDED);
        btn.textContent = 'Collapse';
      } else {
        setSidebarWidth(SIDEBAR_MIN);
        btn.textContent = 'Expand';
      }
    });
  }

  function boot() {
    setSidebarWidth(SIDEBAR_EXPANDED);
    wireThemeToggle();
    wireSidebarDrag();
    wireSidebarToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
