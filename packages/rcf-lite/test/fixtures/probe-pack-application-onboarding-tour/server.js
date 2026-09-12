// Dependency-free sample app for the application-onboarding-tour blueprint
// probe pack. Framework-free by design: one Node HTTP server, a tiny inline
// client script that mounts the tour tooltip and the checklist.
//
// Environment:
//   PORT                              HTTP port (default 3000). Never bind 4200.
//   TOUR_APPS                         Comma-separated applied-blueprint slug
//                                     list mirroring the pack's sidecar
//                                     appliedBlueprints[]. Default: (empty).
//   TOUR_STORE                        Elicited completion-state store.
//                                     Default: spa-local-storage. Values:
//                                     spa-local-storage | spa-session-storage
//                                     | server-side-per-principal.
//   TOUR_ANCHOR                       Elicited checklist-anchor.
//                                     Default: derived from TOUR_APPS
//                                     (dashboard-top when application-dashboard
//                                     is applied, settings-page otherwise).
//
// Query switches:
//   ?apps=<list>                   Override apps for one page load.
//   ?store=<value>                 Override completion store for one load.
//   ?first-run=<0|1>               Force first-run detection.
//   ?complete=1                    Auto-complete the tour on load (drives the
//                                  persistence check without a full walk).
//   ?anchor=<value>                Override the checklist anchor.
//   ?break=no-role                 Drop role="dialog" on the tooltip.
//   ?break=focus-escape            Do NOT trap Tab inside the tooltip.
//   ?break=no-collapse             Render the checklist without a <details>
//                                  wrapper, breaking the collapse contract.
//   ?break=no-persist              Skip the completion write. Under the
//                                  server-side-per-principal store this
//                                  also disables the server-side POST
//                                  /api/tour/completion write, and the
//                                  restart-tour form POST becomes a
//                                  no-op, so the probe (which drives
//                                  the server-side store directly) sees
//                                  the write refuse and the restart
//                                  activation refuse too.

import http from 'node:http';
import { randomUUID as __rid } from 'node:crypto';

// Every response carries an x-fixture-request-id header (positive
// evidence per section 7d): the criterion-e probes echo this id back
// into the run record so a later reader can prove the response was
// answered by this fixture on this run, not fabricated by a local
// mock.
function withRequestId__(handler){
  return async function wrapped__(req,res){
    const rid=__rid();
    const orig=res.writeHead.bind(res);
    res.writeHead=function patched__(){
      const args=Array.from(arguments);
      const last=args[args.length-1];
      if(last&&typeof last==='object'&&!Array.isArray(last)){last['x-fixture-request-id']=rid;}
      else if(Array.isArray(last)){last.push('x-fixture-request-id',rid);}
      else{args.push({'x-fixture-request-id':rid});}
      return orig.apply(res,args);
    };
    return handler(req,res);
  };
}


const PORT = Number(process.env.PORT ?? 3000);
if (PORT === 4200) {
  console.error('refusing to bind PORT=4200 (workspace server owns that port)');
  process.exit(2);
}
const DEFAULT_APPS = String(process.env.TOUR_APPS ?? '');
const DEFAULT_STORE = String(process.env.TOUR_STORE ?? 'spa-local-storage');
const DEFAULT_ANCHOR = process.env.TOUR_ANCHOR;

const STEPS = [
  { id: 'step-1', anchor: '#anchor-1', heading: 'Welcome to your dashboard', body: 'This is the highest-value surface a returning principal reaches.' },
  { id: 'step-2', anchor: '#anchor-2', heading: 'Manage your account', body: 'Reach your profile, security and sessions from the settings surface.' },
  { id: 'step-3', anchor: '#anchor-3', heading: 'Restart this tour', body: 'Use the restart-tour control on the settings surface to see this again.' },
];

function csvSet(csv) {
  return new Set(String(csv || '').split(',').map((s) => s.trim()).filter(Boolean));
}

function parseQuery(url) {
  const q = url.searchParams;
  const apps = csvSet(q.get('apps') ?? DEFAULT_APPS);
  const store = q.get('store') ?? DEFAULT_STORE;
  const firstRun = q.get('first-run') === '1';
  const complete = q.get('complete') === '1';
  const anchorOverride = q.get('anchor');
  const breakSwitch = q.get('break') ?? process.env.PROBE_BREAK ?? '';
  const derivedAnchor = apps.has('application-dashboard') ? 'dashboard-top' : 'settings-page';
  const anchor = anchorOverride || DEFAULT_ANCHOR || derivedAnchor;
  const principalId = typeof q.get('principal-id') === 'string' && q.get('principal-id').length > 0
    ? q.get('principal-id')
    : 'fixture-default-principal';
  return { apps, store, firstRun, complete, breakSwitch, anchor, principalId };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function commonStyles() {
  return `
  body { font-family: system-ui, sans-serif; margin: 1rem; }
  main { max-width: 60rem; }
  details[data-role="onboarding-tour-checklist"] { border: 1px solid #ccc; padding: 0.5rem 1rem; margin: 1rem 0; }
  details[data-role="onboarding-tour-checklist"] summary { cursor: pointer; font-weight: 600; }
  [data-role="onboarding-tour-tooltip"] {
    position: fixed; top: 5rem; left: 5rem;
    max-width: 320px; padding: 1rem; background: #fff;
    border: 2px solid #333; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 1000;
  }
  [data-role="onboarding-tour-tooltip"] h2 { margin-top: 0; }
  [data-role="onboarding-tour-tooltip"] nav { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  [data-role="onboarding-tour-completion-marker"] { display: none; }
  #anchor-1, #anchor-2, #anchor-3 { display: inline-block; padding: 0.25rem 0.5rem; border: 1px dashed #999; margin: 0.25rem; }
  button { font: inherit; padding: 0.25rem 0.75rem; }
  `;
}

function stepsPayload() {
  return JSON.stringify(STEPS);
}

function tourClientScript({ store, breakSwitch, firstRun, complete }) {
  // Escape switches so nothing breaks inside the string literal.
  const s = JSON.stringify(store);
  const b = JSON.stringify(breakSwitch);
  const fr = JSON.stringify(firstRun);
  const co = JSON.stringify(complete);
  return `<script>
(function () {
  var steps = ${stepsPayload()};
  var STORE = ${s};
  var BREAK = ${b};
  var FIRST_RUN = ${fr};
  var COMPLETE = ${co};
  var COMPLETION_KEY = 'onboarding-tour:completion';

  var PRINCIPAL_ID = (function () {
    var main = document.querySelector('[data-tour-principal-id]');
    if (main) return main.getAttribute('data-tour-principal-id');
    return null;
  })();
  // For server-side-per-principal, the server has already rendered
  // data-tour-first-run into the /tour <main> element from the server
  // store, so the client honours the server's decision (rather than
  // reading window.localStorage which is not the applied store).
  function serverRenderedFirstRun() {
    var main = document.querySelector('[data-tour-first-run]');
    if (!main) return null;
    return main.getAttribute('data-tour-first-run') === 'false';
  }
  function readCompletion() {
    try {
      if (STORE === 'spa-local-storage') return window.localStorage.getItem(COMPLETION_KEY);
      if (STORE === 'spa-session-storage') return window.sessionStorage.getItem(COMPLETION_KEY);
      if (STORE === 'server-side-per-principal') {
        // Honour the server-rendered first-run flag as the applied
        // completion signal; the actual store lookup happened at
        // server render (see firstRunAttrs in server.js).
        return serverRenderedFirstRun() === true ? '1' : null;
      }
    } catch (e) { return null; }
    return null;
  }
  function writeCompletion(record) {
    if (BREAK === 'no-persist') return;
    var payload = JSON.stringify(record);
    try {
      if (STORE === 'spa-local-storage') window.localStorage.setItem(COMPLETION_KEY, payload);
      else if (STORE === 'spa-session-storage') window.sessionStorage.setItem(COMPLETION_KEY, payload);
      else if (STORE === 'server-side-per-principal') {
        // Fire-and-forget POST to the server-side completion store.
        // The server is the applied store for this shape; the client
        // no longer keeps a parallel copy in window.storage.
        if (typeof fetch === 'function') {
          var url = '/api/tour/completion?store=server-side-per-principal'
            + (PRINCIPAL_ID ? '&principal-id=' + encodeURIComponent(PRINCIPAL_ID) : '');
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload,
          }).catch(function () { /* fire-and-forget; server DELETE remains authoritative */ });
        }
      }
    } catch (e) { /* noop */ }
    // Marker element makes the write observable in the DOM even for server-side
    // backends where the pack cannot read window.storage directly.
    var mk = document.querySelector('[data-role="onboarding-tour-completion-marker"]');
    if (!mk) {
      mk = document.createElement('div');
      mk.setAttribute('data-role', 'onboarding-tour-completion-marker');
      document.body.appendChild(mk);
    }
    mk.setAttribute('data-written-to', STORE);
    mk.setAttribute('data-record', payload);
  }
  function clearCompletion() {
    try {
      window.localStorage.removeItem(COMPLETION_KEY);
      window.sessionStorage.removeItem(COMPLETION_KEY);
    } catch (e) { /* noop */ }
    // For the server-side store the browser has no copy; the applied
    // store is cleared by the restart-tour form POST below (progressive
    // enhancement: the surrounding form action="/actions/restart-tour"
    // is the source of truth even when JS is off, so this fire-and-
    // forget fetch is a fallback for JS-only clients that intercept
    // the click).
    if (STORE === 'server-side-per-principal' && typeof fetch === 'function') {
      var url = '/actions/restart-tour?store=server-side-per-principal'
        + (PRINCIPAL_ID ? '&principal-id=' + encodeURIComponent(PRINCIPAL_ID) : '');
      fetch(url, { method: 'POST' }).catch(function () { /* server DELETE is authoritative */ });
    }
    var mk = document.querySelector('[data-role="onboarding-tour-completion-marker"]');
    if (mk) mk.parentNode.removeChild(mk);
  }

  function currentStepEl(idx) {
    return document.querySelector('[data-role="onboarding-tour-tooltip"][data-step-id="' + steps[idx].id + '"]');
  }

  function trapFocus(tip) {
    if (BREAK === 'focus-escape') return;
    tip.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var focusables = Array.from(tip.querySelectorAll('[data-tour-control]'));
      if (focusables.length === 0) return;
      var idx = focusables.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); focusables[focusables.length - 1].focus(); }
      } else {
        if (idx === -1 || idx === focusables.length - 1) { e.preventDefault(); focusables[0].focus(); }
      }
    });
  }

  var currentIdx = 0;
  var anchorElBeforeOpen = null;

  function openStep(idx) {
    closeTip();
    if (idx < 0 || idx >= steps.length) return;
    currentIdx = idx;
    var step = steps[idx];
    anchorElBeforeOpen = document.querySelector(step.anchor) || document.body;
    var tip = document.createElement('div');
    tip.setAttribute('data-role', 'onboarding-tour-tooltip');
    tip.setAttribute('data-step-id', step.id);
    if (BREAK !== 'no-role') tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    var headingId = 'tour-heading-' + step.id;
    var bodyId = 'tour-body-' + step.id;
    tip.setAttribute('aria-labelledby', headingId);
    tip.setAttribute('aria-describedby', bodyId);
    tip.innerHTML = '' +
      '<h2 id="' + headingId + '">' + step.heading + '</h2>' +
      '<p id="' + bodyId + '">' + step.body + '</p>' +
      '<nav>' +
      '  <button type="button" data-tour-control="previous">Previous</button>' +
      '  <button type="button" data-tour-control="next">' + (idx === steps.length - 1 ? 'Finish' : 'Next') + '</button>' +
      '  <button type="button" data-tour-control="dismiss">Dismiss</button>' +
      '</nav>';
    // Position the tooltip near the anchor if possible.
    var rect = anchorElBeforeOpen.getBoundingClientRect();
    var top = Math.max(16, Math.min(rect.bottom + 8, Math.max(16, window.innerHeight - 240)));
    var left = Math.max(16, Math.min(rect.left, Math.max(16, window.innerWidth - 340)));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    document.body.appendChild(tip);
    var firstControl = tip.querySelector('[data-tour-control="next"]');
    if (firstControl) firstControl.focus();
    trapFocus(tip);
    tip.querySelector('[data-tour-control="previous"]').addEventListener('click', function () { if (idx > 0) openStep(idx - 1); });
    tip.querySelector('[data-tour-control="next"]').addEventListener('click', function () {
      if (idx < steps.length - 1) openStep(idx + 1);
      else finishTour();
    });
    tip.querySelector('[data-tour-control="dismiss"]').addEventListener('click', function () { dismissTour(); });
  }

  function closeTip() {
    var tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
  }

  function dismissTour() {
    closeTip();
    if (anchorElBeforeOpen && anchorElBeforeOpen.focus) {
      anchorElBeforeOpen.setAttribute('tabindex', '-1');
      anchorElBeforeOpen.focus();
    }
  }

  function finishTour() {
    writeCompletion({ completedAt: new Date().toISOString(), blueprintSetVersion: '1.0.0', stepIds: steps.map(function (s) { return s.id; }) });
    dismissTour();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') dismissTour();
  });

  var restartBtn = document.querySelector('button[data-action="restart-tour"]');
  if (restartBtn) restartBtn.addEventListener('click', function (ev) {
    // Progressive-enhancement contract: for the server-side-per-principal
    // store the restart control is a submit-button inside a
    // <form method="post" action="/actions/restart-tour"> so a plain
    // activation already POSTs the form when JS is off. When JS is on
    // the click listener intercepts (preventDefault) so only ONE POST
    // fires per activation: the fetch-based clearCompletion() below
    // (which also handles the browser-only local/session stores). Without
    // preventDefault the native form submission and the fetch would both
    // fire, double-writing the clear.
    if (restartBtn.form) ev.preventDefault();
    clearCompletion();
  });

  if (typeof location !== 'undefined' && (location.pathname === '/tour' || location.pathname === '/onboarding' || location.pathname === '/welcome')) {
    var alreadyDone = readCompletion();
    if (COMPLETE) {
      openStep(steps.length - 1);
      finishTour();
    } else if (!alreadyDone) {
      // AC-26101-1: the tour opens on the highest-value surface for a first-run
      // principal (i.e. when no completion record is present); a stored completion
      // record suppresses the auto-open on subsequent loads. The FIRST_RUN
      // client-script constant is now a diagnostic breadcrumb only, not an
      // override that forces the dialog past persistence state.
      openStep(0);
    }
  }
})();
</script>`;
}

function checklistHtml({ anchor, apps, breakSwitch }) {
  var items = [
    { id: 'complete-profile', label: 'Complete your profile' },
    { id: 'confirm-email', label: 'Confirm your email' },
    { id: 'explore-dashboard', label: 'Explore the dashboard' },
  ];
  var itemsHtml = items.map(function (it) { return '<li data-checklist-item="' + it.id + '"><label><input type="checkbox"> ' + esc(it.label) + '</label></li>'; }).join('\n      ');
  if (breakSwitch === 'no-collapse') {
    return '<section data-role="onboarding-tour-checklist" data-anchor="' + esc(anchor) + '"><h2>Onboarding checklist</h2><ul>\n      ' + itemsHtml + '\n    </ul></section>';
  }
  var openAttr = anchor === 'dashboard-top' ? ' open' : '';
  return '<details data-role="onboarding-tour-checklist" data-anchor="' + esc(anchor) + '"' + openAttr + '><summary>Onboarding checklist</summary><ul>\n      ' + itemsHtml + '\n    </ul></details>';
}

function page(title, bodyHtml, opts) {
  return '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<style>' + commonStyles() + '</style>\n' +
    '</head>\n' +
    '<body>\n' + bodyHtml + '\n' +
    tourClientScript(opts) + '\n' +
    '</body>\n</html>\n';
}

// Server-side first-run derivation: when the applied completion-state
// store is 'server-side-per-principal', the server-scoped completion
// record decides whether the current principal is first-run on the
// next page load. When the store is a browser-only store, the server
// cannot see the client's local-storage state so it renders the
// first-run attribute as 'unknown' and defers to the client script.
function firstRunAttrs(ctx) {
  if (ctx.store === 'server-side-per-principal') {
    var completed = serverCompletionStore.has(ctx.principalId);
    return {
      firstRun: !completed,
      attrs: ' data-tour-first-run="' + (completed ? 'false' : 'true') + '" data-tour-completion-source="server-side-per-principal" data-tour-principal-id="' + esc(ctx.principalId) + '"',
    };
  }
  return {
    firstRun: null,
    attrs: ' data-tour-first-run="unknown" data-tour-completion-source="' + esc(ctx.store) + '"',
  };
}

function tourPage(ctx) {
  var fr = firstRunAttrs(ctx);
  var body = '' +
    '<main' + fr.attrs + '>' +
    '  <h1>Onboarding tour</h1>' +
    '  <p>The tour opens on a first-run principal; use <code>?first-run=1</code> to force it.</p>' +
    '  <p><button type="button" id="anchor-1">Anchor 1</button> <button type="button" id="anchor-2">Anchor 2</button> <button type="button" id="anchor-3">Anchor 3</button></p>' +
    '</main>';
  return page('Tour', body, ctx);
}

function dashboardPage(ctx) {
  var body = '' +
    '<main>' +
    '  <h1>Dashboard</h1>' +
    '  ' + checklistHtml({ anchor: ctx.anchor, apps: ctx.apps, breakSwitch: ctx.breakSwitch }) +
    '  <p><button type="button" id="anchor-1">Anchor 1</button> <button type="button" id="anchor-2">Anchor 2</button> <button type="button" id="anchor-3">Anchor 3</button></p>' +
    '</main>';
  return page('Dashboard', body, ctx);
}

function settingsPage(ctx) {
  // Progressive-enhancement: for the server-side-per-principal store
  // the restart-tour control lives inside a <form method="post"
  // action="/actions/restart-tour"> so activating it clears the
  // applied server-side store even when JS is off. The client script
  // additionally intercepts the click to fire the same POST via fetch
  // (for SPA parity), but the form action is the source of truth. For
  // browser-only stores (spa-local-storage / spa-session-storage) the
  // restart is JS-only (the DOM button carries the same data-action
  // hook and the client script clears window.storage).
  var restartControl;
  if (ctx.store === 'server-side-per-principal') {
    var actionQuery = 'store=server-side-per-principal&principal-id=' + esc(ctx.principalId);
    restartControl = '' +
      '<form method="post" action="/actions/restart-tour?' + actionQuery + '" data-role="restart-tour-form">' +
      '  <input type="hidden" name="principal-id" value="' + esc(ctx.principalId) + '">' +
      '  <input type="hidden" name="store" value="server-side-per-principal">' +
      '  <button type="submit" data-action="restart-tour">Restart tour</button>' +
      '</form>';
  } else {
    restartControl = '<button type="button" data-action="restart-tour">Restart tour</button>';
  }
  var body = '' +
    '<main>' +
    '  <h1>Settings</h1>' +
    '  ' + restartControl +
    '  ' + checklistHtml({ anchor: ctx.anchor === 'dashboard-top' ? 'settings-page' : ctx.anchor, apps: ctx.apps, breakSwitch: ctx.breakSwitch }) +
    '  <p><button type="button" id="anchor-1">Anchor 1</button> <button type="button" id="anchor-2">Anchor 2</button> <button type="button" id="anchor-3">Anchor 3</button></p>' +
    '</main>';
  return page('Settings', body, ctx);
}

function homePage(ctx) {
  var body = '<main><h1>Sample app</h1><p><a href="/tour">Tour</a>, <a href="/dashboard">Dashboard</a>, <a href="/settings">Settings</a>.</p></main>';
  return page('Home', body, ctx);
}

// AC-26104-1 server-scoped completion store: when the applied
// completion-state store is 'server-side-per-principal', the fixture
// holds the completion record on the server keyed by principal id
// (X-Principal-Id header or ?principal-id= query, defaulting to a
// single-organisation fixture principal so probes can vary it). Endpoints:
//   POST   /api/tour/completion  -> write completion for principal
//   GET    /api/tour/completion  -> read (or 404 when absent)
//   DELETE /api/tour/completion  -> clear (models the restart-tour
//                                  control effect on the server)
// The store is per-process, so probes must run the write / read /
// clear against the same fixture instance.
var serverCompletionStore = new Map();

function readPrincipalId(req, url) {
  var header = req.headers['x-principal-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  var q = url.searchParams.get('principal-id');
  return typeof q === 'string' && q.length > 0 ? q : 'fixture-default-principal';
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

const server = http.createServer(withRequestId__(function (req, res) {
  var url = new URL(req.url, 'http://' + req.headers.host);
  var ctx = parseQuery(url);

  // AC-26104-1 server-side completion API (only exercised when the
  // applied store is 'server-side-per-principal').
  if (url.pathname === '/api/tour/completion') {
    var principalId = readPrincipalId(req, url);
    if (ctx.store !== 'server-side-per-principal') {
      return sendJson(res, 409, { error: 'completion-state store is not server-side-per-principal', store: ctx.store });
    }
    if (req.method === 'POST') {
      var body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        var parsed;
        try { parsed = body.length ? JSON.parse(body) : {}; } catch (e) { parsed = null; }
        if (!parsed || typeof parsed !== 'object') return sendJson(res, 400, { error: 'invalid body' });
        // Break switch: when the server is booted with
        // PROBE_BREAK=no-persist (or the caller passes ?break=no-persist),
        // the server refuses the write so the probe's persistence
        // observation goes fail. The refusal returns a defined error
        // shape rather than silently swallowing the write, per the
        // exception-evidence rule.
        if (ctx.breakSwitch === 'no-persist') {
          return sendJson(res, 507, {
            error: 'COMPLETION_WRITE_FAILED',
            reason: 'server-side completion write refused by no-persist break switch',
            principalId: principalId,
          });
        }
        var record = {
          completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : new Date().toISOString(),
          blueprintSetVersion: typeof parsed.blueprintSetVersion === 'string' ? parsed.blueprintSetVersion : '1.0.0',
          stepIds: Array.isArray(parsed.stepIds) ? parsed.stepIds : STEPS.map(function (s) { return s.id; }),
          principalId: principalId,
        };
        serverCompletionStore.set(principalId, record);
        return sendJson(res, 200, { ok: true, principalId: principalId, record: record });
      });
      return;
    }
    if (req.method === 'GET') {
      var stored = serverCompletionStore.get(principalId);
      if (!stored) return sendJson(res, 404, { principalId: principalId, completed: false });
      return sendJson(res, 200, { principalId: principalId, completed: true, record: stored });
    }
    if (req.method === 'DELETE') {
      serverCompletionStore.delete(principalId);
      return sendJson(res, 200, { ok: true, principalId: principalId });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // AC-26104-1 progressive-enhancement restart-tour action. The
  // settings surface renders the restart control inside a
  // <form method="post" action="/actions/restart-tour"> for the
  // server-side-per-principal store, so activating the control
  // (JS-off or JS-on) POSTs here. The handler clears the server-side
  // completion record for the principal and returns 200 with a
  // machine-readable body so the probe can derive the effect. The
  // no-persist break switch refuses the clear too (matching the
  // write refusal) so the probe's activation observation goes fail.
  if (url.pathname === '/actions/restart-tour' && req.method === 'POST') {
    var actionPrincipalId = readPrincipalId(req, url);
    if (ctx.store !== 'server-side-per-principal') {
      return sendJson(res, 409, { error: 'restart-tour action requires server-side-per-principal store', store: ctx.store, principalId: actionPrincipalId });
    }
    if (ctx.breakSwitch === 'no-persist') {
      return sendJson(res, 507, {
        error: 'COMPLETION_CLEAR_FAILED',
        reason: 'server-side completion clear refused by no-persist break switch',
        principalId: actionPrincipalId,
      });
    }
    var hadRecord = serverCompletionStore.has(actionPrincipalId);
    serverCompletionStore.delete(actionPrincipalId);
    return sendJson(res, 200, {
      ok: true,
      principalId: actionPrincipalId,
      cleared: hadRecord,
      restartControl: 'restart-tour',
    });
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/' || url.pathname === '/home') { res.end(homePage(ctx)); return; }
  if (url.pathname === '/tour' || url.pathname === '/onboarding' || url.pathname === '/welcome') { res.end(tourPage(ctx)); return; }
  if (url.pathname === '/dashboard') { res.end(dashboardPage(ctx)); return; }
  if (url.pathname === '/settings' || url.pathname === '/account' || url.pathname === '/account/settings') { res.end(settingsPage(ctx)); return; }
  res.statusCode = 404;
  res.end(page('Not found', '<main><h1>Not found</h1></main>', ctx));
}));

server.listen(PORT, function () {
  console.log('LISTENING ' + PORT);
});
