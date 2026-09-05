// Sample-app fixture for the application-notifications-in-app probe pack.
//
// A dependency-free Node HTTP server that renders the three surfaces
// the blueprint's three pack checks probe:
//
//   /                        the main application shell (with a toast
//                            trigger the pack activates via evaluate)
//   /notifications-centre    the notification centre inbox with a
//                            seeded backlog of notifications, mark-read,
//                            mark-all-read and per-item acknowledge
//                            controls reachable by Tab
//   /notifications-preferences  the preferences UI with per-category
//                            silence toggles and sibling-channel digest
//                            opt-in sections (disabled by default because
//                            no sibling channel is applied on the fixture)
//
// Every route preseeds two live-region wrappers at page load: a polite
// wrapper `[aria-live="polite"] [data-live-region="polite"]` and an
// assertive wrapper `[role="alert"] [data-live-region="assertive"]`.
// Both wrappers are empty at load; toasts fired via `POST /__emit` land
// inside the wrapper whose role reflects the toast priority per ADR-2101.
//
// Break switches (query parameters on every route) let the probe pack
// drive the negative runs:
//   ?break=preseed   the wrappers are inserted lazily on the first
//                    toast (not present at page load) so the preseed
//                    check refuses ship
//   ?break=role      an error toast renders inside the polite wrapper
//                    with `role="status"` (or an info toast renders
//                    inside the assertive wrapper with `role="alert"`)
//                    so the role-mapping check refuses ship
//   ?break=timeout   toasts dismiss at two seconds instead of six so
//                    the WCAG 2.2.1 floor is not met and the toast
//                    check refuses ship
//   ?break=ack       the acknowledge control never POSTs (the click
//                    handler is a no-op) so the acknowledge round-trip
//                    check refuses ship
//
// The toast timeout floor defaults to six seconds (per ADR-2102); the
// shell root carries `data-toast-timeout-floor-seconds` naming the
// floor. `?timeoutMs=<n>` overrides the actual dismissal time (used by
// the fixture unit tests to drive a short timeout without waiting six
// seconds on every run); the pack always drives the shipped six-second
// default so the check measures the ratified floor honestly.
//
// PORT env var picks the port (default 3000). The server prints
// `LISTENING <port>` once bound so a caller can grep for it.
//
// startServer({ port }) is exported so tests can drive the server
// on ephemeral ports without a subprocess.

import http from 'node:http';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT_FLOOR_MS = 6000;
const BREAK_TIMEOUT_MS = 2000;

// Fixed backlog the notification centre renders. Timestamps sit inside
// the ADR-2103 retention window (thirty days) relative to a stable
// reference so the pack's assertions read a stable value.
const REFERENCE_NOW = new Date('2026-09-04T22:00:00Z').getTime();
const BACKLOG = [
  {
    notificationId: 'n-1',
    category: 'security',
    priority: 'error',
    body: 'Suspicious sign-in from a new device',
    deliveredAt: new Date(REFERENCE_NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
    dismissedAt: null,
    acknowledgedAt: null,
  },
  {
    notificationId: 'n-2',
    category: 'payment',
    priority: 'info',
    body: 'Invoice INV-1041 paid',
    deliveredAt: new Date(REFERENCE_NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
    dismissedAt: new Date(REFERENCE_NOW - 5 * 24 * 60 * 60 * 1000 + 1000).toISOString(),
    acknowledgedAt: null,
  },
  {
    notificationId: 'n-3',
    category: 'product',
    priority: 'info',
    body: 'Weekly summary ready',
    deliveredAt: new Date(REFERENCE_NOW - 1 * 24 * 60 * 60 * 1000).toISOString(),
    dismissedAt: null,
    acknowledgedAt: null,
  },
];

const CATEGORIES = ['security', 'payment', 'product'];
const SIBLING_CHANNELS = ['email', 'push', 'webhook'];

const requestLog = [];
const deliveryLog = BACKLOG.map((row) => ({ ...row }));

function recordRequest(entry) {
  requestLog.push({ ...entry, at: new Date().toISOString() });
}

function readTimeoutMs(url, brk) {
  if (brk === 'timeout') return BREAK_TIMEOUT_MS;
  const override = Number(url.searchParams.get('timeoutMs'));
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_TIMEOUT_FLOOR_MS;
}

function renderLiveRegions({ brk }) {
  if (brk === 'preseed') {
    // Wrappers are NOT rendered at page load; the client script injects
    // them lazily on the first toast fire, which is the defect the
    // preseeding check refuses on.
    return '';
  }
  return (
    '<div class="notificationsLiveRegionPolite" aria-live="polite" data-live-region="polite" role="status"></div>' +
    '<div class="notificationsLiveRegionAssertive" role="alert" data-live-region="assertive"></div>'
  );
}

function renderShellRoot({ route, brk }) {
  const timeoutFloorSeconds = brk === 'timeout' ? '2' : '6';
  return (
    'data-region="shell-root" ' +
    `data-route="${route}" ` +
    `data-break="${brk || ''}" ` +
    `data-toast-timeout-floor-seconds="${timeoutFloorSeconds}"`
  );
}

function renderNavigation() {
  return (
    '<nav class="shellNav" aria-label="Notifications sample app">' +
    '<a href="/" data-route-link="/">Main</a> ' +
    '<a href="/notifications-centre" data-route-link="/notifications-centre">Centre</a> ' +
    '<a href="/notifications-preferences" data-route-link="/notifications-preferences">Preferences</a>' +
    '</nav>'
  );
}

function renderMainRoute({ brk, timeoutMs }) {
  const liveRegions = renderLiveRegions({ brk });
  const shellAttrs = renderShellRoot({ route: '/', brk });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>application-notifications-in-app fixture (main)</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; margin: 0; }
  .shellHeading { font-size: 18px; margin: 0 0 12px; }
  .shellNav { display: flex; gap: 12px; margin-bottom: 12px; }
  .notificationsLiveRegionPolite,
  .notificationsLiveRegionAssertive {
    display: block; position: relative; margin: 12px 0; min-height: 12px;
    border: 1px dashed #ccc; padding: 8px; border-radius: 4px; background: #fafafa;
  }
  .toast {
    display: block; padding: 8px 12px; border-radius: 4px; margin: 6px 0;
    border: 1px solid #1f3b73; background: #f6f8ff; color: #1f3b73;
  }
  .toast[data-toast-priority="error"] {
    border-color: #7a1a1a; background: #fff5f5; color: #7a1a1a;
  }
  .toastDismiss { border: 1px solid #1f3b73; background: #fff; color: #1f3b73; margin-left: 8px; }
  .toastBody { display: inline-block; }
  .toastControls { display: inline-block; margin-left: 8px; }
  button { cursor: pointer; }
</style>
</head>
<body>
<main ${shellAttrs}>
  <h1 class="shellHeading">application-notifications-in-app main</h1>
  ${renderNavigation()}
  ${liveRegions}
  <section aria-label="Toast triggers" class="toastTriggers">
    <button type="button" data-toast-trigger="info" data-toast-category="product">Fire info toast</button>
    <button type="button" data-toast-trigger="error" data-toast-category="security">Fire error toast</button>
  </section>
</main>
<script>
${clientScript({ brk, timeoutMs })}
</script>
</body>
</html>
`;
}

function renderCentreRoute({ brk }) {
  const liveRegions = renderLiveRegions({ brk });
  const shellAttrs = renderShellRoot({ route: '/notifications-centre', brk });
  const items = deliveryLog.map((row) => renderCentreItem(row, brk)).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>application-notifications-in-app fixture (centre)</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; margin: 0; }
  .shellHeading { font-size: 18px; margin: 0 0 12px; }
  .shellNav { display: flex; gap: 12px; margin-bottom: 12px; }
  .notificationsLiveRegionPolite,
  .notificationsLiveRegionAssertive {
    display: block; position: relative; margin: 12px 0; min-height: 12px;
    border: 1px dashed #ccc; padding: 8px; border-radius: 4px; background: #fafafa;
  }
  .centreInbox { display: flex; flex-direction: column; gap: 8px; }
  .centreItem { border: 1px solid #ccc; padding: 10px; border-radius: 4px; }
  .centreItem[data-acknowledged="true"] { border-color: #1f7a3a; background: #f2fbf5; }
  .centreItemControls { margin-top: 6px; display: flex; gap: 8px; }
  .centreItemControls button { border: 1px solid #1f3b73; background: #fff; color: #1f3b73; padding: 4px 10px; border-radius: 4px; }
  .centreControlsRow { margin-bottom: 12px; }
  button { cursor: pointer; }
</style>
</head>
<body>
<main ${shellAttrs}>
  <h1 class="shellHeading">application-notifications-in-app centre</h1>
  ${renderNavigation()}
  ${liveRegions}
  <div class="centreControlsRow">
    <button type="button" data-action="mark-all-read">Mark all read</button>
  </div>
  <section role="region" aria-label="Notification centre inbox" data-region="notifications-centre" class="centreInbox">
    ${items}
  </section>
</main>
<script>
${clientScript({ brk, timeoutMs: DEFAULT_TIMEOUT_FLOOR_MS })}
</script>
</body>
</html>
`;
}

function renderCentreItem(row, brk) {
  const acknowledgedAttr = row.acknowledgedAt ? 'true' : 'false';
  const ackDisabled = row.acknowledgedAt ? ' aria-disabled="true"' : '';
  return (
    `<article class="centreItem" data-notification-id="${row.notificationId}" data-category="${row.category}" data-priority="${row.priority}" data-delivered-at="${row.deliveredAt}" data-acknowledged="${acknowledgedAttr}">` +
      `<h3 class="centreItemTitle">${row.body}</h3>` +
      `<p class="centreItemMeta">${row.category} / ${row.priority} / ${row.deliveredAt}</p>` +
      `<div class="centreItemControls">` +
        `<button type="button" data-action="acknowledge" data-notification-id="${row.notificationId}"${ackDisabled}>Acknowledge</button>` +
        `<button type="button" data-action="mark-read" data-notification-id="${row.notificationId}">Mark read</button>` +
      `</div>` +
    `</article>`
  );
}

function renderPreferencesRoute({ brk }) {
  const liveRegions = renderLiveRegions({ brk });
  const shellAttrs = renderShellRoot({ route: '/notifications-preferences', brk });
  const categorySections = CATEGORIES.map((category) => (
    `<section data-preference-section="category" class="preferenceCategory">` +
      `<label><input type="checkbox" data-preference-category="${category}" data-silenced="false" /> Silence ${category} notifications</label>` +
    `</section>`
  )).join('');
  const siblingSections = SIBLING_CHANNELS.map((channel) => (
    `<section data-preference-section="${channel}" data-preference-status="sibling not applied" class="preferenceSibling">` +
      `<label><input type="checkbox" data-digest-${channel}="false" aria-disabled="true" disabled /> Digest via ${channel} (sibling blueprint not applied)</label>` +
    `</section>`
  )).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>application-notifications-in-app fixture (preferences)</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; margin: 0; }
  .shellHeading { font-size: 18px; margin: 0 0 12px; }
  .shellNav { display: flex; gap: 12px; margin-bottom: 12px; }
  .notificationsLiveRegionPolite,
  .notificationsLiveRegionAssertive {
    display: block; position: relative; margin: 12px 0; min-height: 12px;
    border: 1px dashed #ccc; padding: 8px; border-radius: 4px; background: #fafafa;
  }
  .preferenceCategory, .preferenceSibling { border: 1px solid #ccc; padding: 10px; border-radius: 4px; margin: 6px 0; }
  .preferenceSibling { opacity: 0.6; }
</style>
</head>
<body>
<main ${shellAttrs}>
  <h1 class="shellHeading">application-notifications-in-app preferences</h1>
  ${renderNavigation()}
  ${liveRegions}
  <section aria-label="Category silence preferences">
    <h2>Categories</h2>
    ${categorySections}
  </section>
  <section aria-label="Sibling channel digest preferences">
    <h2>Digest via sibling channels</h2>
    ${siblingSections}
  </section>
</main>
<script>
${clientScript({ brk, timeoutMs: DEFAULT_TIMEOUT_FLOOR_MS })}
</script>
</body>
</html>
`;
}

function clientScript({ brk, timeoutMs }) {
  return `(function () {
  window.__notificationFetches = [];
  var brk = ${JSON.stringify(brk || null)};
  var timeoutMs = ${JSON.stringify(timeoutMs)};

  function recordFetch(entry) {
    window.__notificationFetches.push(entry);
    fetch('/__record?type=' + encodeURIComponent(entry.type) + '&notificationId=' + encodeURIComponent(entry.notificationId || '') + '&category=' + encodeURIComponent(entry.category || '') + '&priority=' + encodeURIComponent(entry.priority || '')).catch(function () {});
  }

  function ensureLiveRegions() {
    var main = document.querySelector('[data-region="shell-root"]');
    if (!main) return { polite: null, assertive: null };
    var polite = document.querySelector('[data-live-region="polite"]');
    var assertive = document.querySelector('[data-live-region="assertive"]');
    if (!polite && brk === 'preseed') {
      polite = document.createElement('div');
      polite.className = 'notificationsLiveRegionPolite';
      polite.setAttribute('aria-live', 'polite');
      polite.setAttribute('data-live-region', 'polite');
      polite.setAttribute('role', 'status');
      main.appendChild(polite);
    }
    if (!assertive && brk === 'preseed') {
      assertive = document.createElement('div');
      assertive.className = 'notificationsLiveRegionAssertive';
      assertive.setAttribute('role', 'alert');
      assertive.setAttribute('data-live-region', 'assertive');
      main.appendChild(assertive);
    }
    return { polite: polite, assertive: assertive };
  }

  var toastSequence = 0;
  function fireToast(priority, category) {
    toastSequence += 1;
    var toastId = 't-' + toastSequence;
    var notificationId = 'live-' + toastSequence;
    var wrappers = ensureLiveRegions();
    var wrapper;
    var role;
    if (priority === 'error') {
      if (brk === 'role') { wrapper = wrappers.polite; role = 'status'; }
      else { wrapper = wrappers.assertive; role = 'alert'; }
    } else {
      if (brk === 'role') { wrapper = wrappers.assertive; role = 'alert'; }
      else { wrapper = wrappers.polite; role = 'status'; }
    }
    if (!wrapper) return null;
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', role);
    toast.setAttribute('data-toast-id', toastId);
    toast.setAttribute('data-toast-priority', priority);
    toast.setAttribute('data-toast-category', category || 'product');
    var shownAt = new Date().toISOString();
    toast.setAttribute('data-shown-at', shownAt);
    var body = document.createElement('span');
    body.className = 'toastBody';
    body.textContent = (priority === 'error' ? 'Error: ' : 'Info: ') + (category || 'product') + ' notification ' + toastId;
    toast.appendChild(body);
    var controls = document.createElement('span');
    controls.className = 'toastControls';
    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'toastDismiss';
    dismiss.setAttribute('data-action', 'dismiss');
    dismiss.setAttribute('data-toast-id', toastId);
    dismiss.textContent = 'Dismiss';
    controls.appendChild(dismiss);
    toast.appendChild(controls);
    wrapper.appendChild(toast);
    recordFetch({ type: 'toast-fired', notificationId: notificationId, category: category || 'product', priority: priority });
    function dismissToast() {
      if (toast.getAttribute('data-dismissed-at')) return;
      toast.setAttribute('data-dismissed-at', new Date().toISOString());
      recordFetch({ type: 'toast-dismissed', notificationId: notificationId, category: category || 'product', priority: priority });
    }
    dismiss.addEventListener('click', dismissToast);
    setTimeout(dismissToast, timeoutMs);
    return toast;
  }
  window.__fireToast = fireToast;

  Array.from(document.querySelectorAll('[data-toast-trigger]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var priority = btn.getAttribute('data-toast-trigger');
      var category = btn.getAttribute('data-toast-category');
      fireToast(priority, category);
    });
  });

  Array.from(document.querySelectorAll('[data-action="acknowledge"]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var notificationId = btn.getAttribute('data-notification-id');
      if (brk === 'ack') {
        // The click handler is a no-op: no POST, no DOM update.
        return;
      }
      recordFetch({ type: 'acknowledge', notificationId: notificationId, category: null, priority: null });
      fetch('/api/notifications/acknowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notificationId: notificationId })
      }).then(function (res) {
        if (res.status !== 200) return;
        var article = document.querySelector('[data-notification-id="' + notificationId + '"]');
        if (article) article.setAttribute('data-acknowledged', 'true');
      }).catch(function () {});
    });
  });

  Array.from(document.querySelectorAll('[data-action="mark-read"]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var notificationId = btn.getAttribute('data-notification-id');
      recordFetch({ type: 'mark-read', notificationId: notificationId, category: null, priority: null });
      var article = document.querySelector('[data-notification-id="' + notificationId + '"]');
      if (article) article.setAttribute('data-read', 'true');
    });
  });

  var markAllRead = document.querySelector('[data-action="mark-all-read"]');
  if (markAllRead) {
    markAllRead.addEventListener('click', function () {
      recordFetch({ type: 'mark-all-read', notificationId: null, category: null, priority: null });
      Array.from(document.querySelectorAll('[data-notification-id]')).forEach(function (article) {
        article.setAttribute('data-read', 'true');
      });
    });
  }
})();`;
}

function respondHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function respondJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function respondNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function normaliseBreak(v) {
  if (v === 'preseed' || v === 'role' || v === 'timeout' || v === 'ack') return v;
  return null;
}

async function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function handler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const brk = normaliseBreak(url.searchParams.get('break'));
  if (req.method === 'GET') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const timeoutMs = readTimeoutMs(url, brk);
      respondHtml(res, renderMainRoute({ brk, timeoutMs }));
      return;
    }
    if (url.pathname === '/notifications-centre') {
      respondHtml(res, renderCentreRoute({ brk }));
      return;
    }
    if (url.pathname === '/notifications-preferences') {
      respondHtml(res, renderPreferencesRoute({ brk }));
      return;
    }
    if (url.pathname === '/__requests') {
      respondJson(res, requestLog);
      return;
    }
    if (url.pathname === '/__record') {
      recordRequest({
        kind: url.searchParams.get('type'),
        notificationId: url.searchParams.get('notificationId'),
        category: url.searchParams.get('category'),
        priority: url.searchParams.get('priority'),
      });
      respondJson(res, { ok: true });
      return;
    }
    if (url.pathname === '/api/delivery-log') {
      respondJson(res, { rows: deliveryLog });
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    respondNotFound(res);
    return;
  }
  if (req.method === 'POST') {
    if (url.pathname === '/__emit') {
      // Emit a toast via a POST from the pack (the pack calls this
      // through `evaluate(async () => await fetch('/__emit', ...))`).
      readJsonBody(req).then((body) => {
        const priority = body.priority === 'error' ? 'error' : 'info';
        const category = typeof body.category === 'string' ? body.category : 'product';
        recordRequest({ kind: 'emit', priority, category, notificationId: null });
        respondJson(res, { ok: true, priority, category });
      });
      return;
    }
    if (url.pathname === '/api/notifications/acknowledge') {
      readJsonBody(req).then((body) => {
        const notificationId = body && typeof body.notificationId === 'string' ? body.notificationId : null;
        if (notificationId) {
          const row = deliveryLog.find((r) => r.notificationId === notificationId);
          if (row) row.acknowledgedAt = new Date().toISOString();
        }
        recordRequest({ kind: 'acknowledge-server', notificationId, category: null, priority: null });
        respondJson(res, { ok: true, notificationId });
      });
      return;
    }
    if (url.pathname === '/api/preferences/category') {
      readJsonBody(req).then(() => {
        respondJson(res, { ok: true });
      });
      return;
    }
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
}

export function startServer({ port } = {}) {
  const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : desiredPort;
      resolve({ server, port: boundPort });
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const desiredPort = Number(process.env.PORT ?? 3000);
  startServer({ port: desiredPort }).then(({ port }) => {
    process.stdout.write(`LISTENING ${port}\n`);
  }).catch((err) => {
    process.stderr.write(`fixture failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
