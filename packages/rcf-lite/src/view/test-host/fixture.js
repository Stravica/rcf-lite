// Wespa host fixture (viewer UI refresh PR 9; TAC-4134, ADR-4136).
// Served by the viewer's own dev server at /test-host.html when
// --test-host is passed (or RCF_VIEW_TEST_HOST=1 is set); 404 otherwise
// so wespa's reverse-proxy allow-list is unaffected. Mimics the wespa
// shell: a 56px header carrying a Light/Dark toggle, a resizable
// sidebar (64px collapsed, 200-400px expanded, user-resizable live via
// a drag handle), a content pane carrying a single iframe pointed at
// the viewer root ("./?embed=1&theme=light" resolves to "/?..."
// because the fixture lives at the root path, not under /test-host/).
// The fixture carries no inline script; its client-side wiring lives
// at /test-host.js (served as a snapshotted asset at startup; see
// server/index.js).
//
// The fixture does not persist theme to localStorage: a passing run
// has to flip the iframe through the postMessage path, which is the
// invariant ADR-4136 pins. The host never reads event.origin itself
// (the viewer does); the host only READS the iframe's data-theme and
// data-embed attributes as evidence.

/**
 * Return the fixture HTML string. Pure function, no I/O.
 *
 * @returns {string}
 */
export function renderTestHostPage() {
  return `<!DOCTYPE html>
<html lang="en-GB" data-rcf-test-host="wespa">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wespa host fixture - rcf-lite viewer embed proof</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
      display: grid;
      grid-template-rows: 56px 1fr;
      background: #0e1116;
      color: #c9d1d9;
    }
    header.wespa-header {
      height: 56px;
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0 1rem;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      box-sizing: border-box;
    }
    header.wespa-header .wespa-brand {
      font-weight: 700;
      font-size: 0.95rem;
      letter-spacing: -0.01em;
    }
    header.wespa-header .wespa-brand-sub {
      color: #8b949e;
      font-size: 0.85rem;
      margin-left: 0.5rem;
    }
    header.wespa-header .wespa-theme-toggle {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
    }
    header.wespa-header .wespa-theme-toggle button {
      appearance: none;
      border: 1px solid #30363d;
      background: #0e1116;
      color: #c9d1d9;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
    }
    header.wespa-header .wespa-theme-toggle button[aria-pressed="true"] {
      background: #1f6feb;
      border-color: #1f6feb;
      color: #ffffff;
      font-weight: 600;
    }
    main.wespa-shell {
      display: grid;
      grid-template-columns: var(--wespa-sidebar-width, 200px) 1fr;
      overflow: hidden;
    }
    aside.wespa-sidebar {
      background: #161b22;
      border-right: 1px solid #30363d;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    aside.wespa-sidebar .wespa-sidebar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #30363d;
    }
    aside.wespa-sidebar .wespa-sidebar-head button {
      appearance: none;
      border: 1px solid #30363d;
      background: #0e1116;
      color: #c9d1d9;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
    }
    aside.wespa-sidebar .wespa-sidebar-items {
      flex: 1;
      overflow: auto;
      padding: 0.5rem;
      color: #8b949e;
      font-size: 0.85rem;
    }
    aside.wespa-sidebar .wespa-sidebar-items p { margin: 0 0 0.5rem; }
    aside.wespa-sidebar.collapsed .wespa-sidebar-items { display: none; }
    aside.wespa-sidebar .wespa-sidebar-drag {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      background: transparent;
    }
    aside.wespa-sidebar .wespa-sidebar-drag:hover,
    aside.wespa-sidebar .wespa-sidebar-drag.dragging {
      background: #1f6feb;
    }
    section.wespa-content {
      position: relative;
      overflow: hidden;
      background: #0e1116;
    }
    iframe.wespa-iframe {
      border: 0;
      width: 100%;
      height: 100%;
      display: block;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <header class="wespa-header">
    <span class="wespa-brand">Wespa</span>
    <span class="wespa-brand-sub">rcf-lite viewer embed proof</span>
    <div class="wespa-theme-toggle" role="group" aria-label="Iframe theme">
      <span>Theme</span>
      <button type="button" data-rcf-host-theme="light" aria-pressed="true">Light</button>
      <button type="button" data-rcf-host-theme="dark" aria-pressed="false">Dark</button>
    </div>
  </header>
  <main class="wespa-shell">
    <aside class="wespa-sidebar" data-rcf-host-sidebar>
      <div class="wespa-sidebar-head">
        <span>Projects</span>
        <button type="button" data-rcf-host-sidebar-toggle>Collapse</button>
      </div>
      <div class="wespa-sidebar-items">
        <p>rcf-lite</p>
        <p>wespa</p>
        <p>design docs</p>
      </div>
      <div class="wespa-sidebar-drag" data-rcf-host-sidebar-drag title="Drag to resize"></div>
    </aside>
    <section class="wespa-content">
      <iframe class="wespa-iframe" id="rcf-test-host-iframe" title="rcf-lite viewer" src="./?embed=1&amp;theme=light"></iframe>
    </section>
  </main>
  <script src="./test-host.js" defer></script>
</body>
</html>
`;
}
