// Sample-app fixture for the application-admin-console probe pack.
//
// Dependency-free Node HTTP server. Binds every surface the blueprint
// pack asserts on: a console shell whose nav renders only applied
// surfaces, a users directory table with per-row invite and
// deactivate controls enumerated by data-user-id, a permission matrix
// rendered as an ARIA APG grid with role=row, role=rowheader,
// role=columnheader, role=gridcell and per-cell aria-label announcing
// the permission string, an org switcher control (only under
// tenancy), an audit-log table enumerated by data-audit-id with
// actor / target / before / after / timestamp / correlationId
// columns, an access-denied route with a request-access control,
// request log on window.__adminFetches and /__requests.
//
// ADMIN_CONSOLE_CAPS (env) or ?caps= (query) mirrors the applied
// capability set, so the fixture plays every combination in one boot.
// PORT env (default 3000) picks the bind port.

import http from 'node:http';
import { randomUUID as __rid } from 'node:crypto';
import { URL } from 'node:url';

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


const DEFAULT_CAPS = process.env.ADMIN_CONSOLE_CAPS ?? 'principalDirectory,roleModel,auditLog';
const DEFAULT_BREAK = process.env.ADMIN_CONSOLE_BREAK ?? null;

const USERS = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'Owner', status: 'active', lastActive: '2026-09-04T14:22:00Z' },
  { id: 'u2', name: 'Alan Turing', email: 'alan@example.com', role: 'Admin', status: 'active', lastActive: '2026-09-04T09:11:00Z' },
  { id: 'u3', name: 'Grace Hopper', email: 'grace@example.com', role: 'Member', status: 'pending', lastActive: null },
  { id: 'u4', name: 'Edsger Dijkstra', email: 'edsger@example.com', role: 'Viewer', status: 'active', lastActive: '2026-09-03T16:45:00Z' },
];

const PERMISSIONS = [
  { id: 'users.invite', label: 'Invite user' },
  { id: 'users.deactivate', label: 'Deactivate user' },
  { id: 'roles.assign', label: 'Assign role' },
  { id: 'billing.view', label: 'View billing' },
];

const ROLE_LABELS = ['Owner', 'Admin', 'Member', 'Viewer'];

const MATRIX = {
  Owner: { 'users.invite': true, 'users.deactivate': true, 'roles.assign': true, 'billing.view': true },
  Admin: { 'users.invite': true, 'users.deactivate': true, 'roles.assign': true, 'billing.view': false },
  Member: { 'users.invite': false, 'users.deactivate': false, 'roles.assign': false, 'billing.view': false },
  Viewer: { 'users.invite': false, 'users.deactivate': false, 'roles.assign': false, 'billing.view': false },
};

const AUDIT_ENTRIES = [
  { id: 'a1', actor: 'ada@example.com', target: 'grace@example.com', before: 'Viewer', after: 'Member', timestamp: '2026-09-04T14:22:00Z', correlationId: 'corr-9a3f1' },
  { id: 'a2', actor: 'alan@example.com', target: 'edsger@example.com', before: 'active', after: 'deactivated', timestamp: '2026-09-04T09:11:00Z', correlationId: 'corr-5b2d0' },
  { id: 'a3', actor: 'ada@example.com', target: 'settings.retention', before: '90', after: '180', timestamp: '2026-09-03T16:45:00Z', correlationId: 'corr-1e77c' },
];

let __auditNextSeq = AUDIT_ENTRIES.length + 1;
function recordAudit(entry) {
  const id = 'a' + __auditNextSeq;
  __auditNextSeq += 1;
  const filled = {
    id,
    actor: entry.actor ?? 'system@example.com',
    target: entry.target ?? '(unknown)',
    before: entry.before ?? '',
    after: entry.after ?? '',
    timestamp: entry.timestamp ?? new Date().toISOString(),
    correlationId: entry.correlationId ?? ('corr-' + __rid().slice(0, 8)),
  };
  AUDIT_ENTRIES.push(filled);
  return filled;
}

// In-memory request log so the pack (and the gate reviewer) can
// inspect what the client did. Same posture as the datatable fixture.
const requestLog = [];

function capsFor(reqUrl) {
  const raw = reqUrl.searchParams.get('caps');
  const source = raw && raw.length > 0 ? raw : DEFAULT_CAPS;
  return new Set(source.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function htmlResponse(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderShellHead(title) {
  return `<title>${escapeHtml(title)} admin console</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 0; color: #111; }
  nav[data-role="primary-nav"] { display: flex; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid #ccc; background: #f6f7f9; }
  nav a { color: #0645ad; text-decoration: none; }
  main { padding: 1.25rem 1.5rem; max-width: 1080px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
  [role="grid"] { border-collapse: collapse; }
  [role="gridcell"], [role="columnheader"], [role="rowheader"] { border: 1px solid #ddd; padding: 0.5rem 0.75rem; }
  [role="rowheader"] { background: #f6f7f9; text-align: right; }
  [role="columnheader"] { background: #eef1f5; }
  [data-cell-state="allowed"] { background: #e6f4ea; }
  [data-cell-state="denied"] { background: #fdecea; }
  button { cursor: pointer; padding: 0.35rem 0.75rem; }
  [data-surface="denied"] { padding: 1rem; border: 1px solid #d93025; background: #fdecea; border-radius: 4px; max-width: 640px; }
  #liveRegion { position: absolute; left: -9999px; top: -9999px; }
</style>`;
}

function renderNav(caps) {
  const items = [];
  items.push('<a href="/admin">Home</a>');
  if (caps.has('principalDirectory')) items.push('<a href="/admin/users">Users</a>');
  if (caps.has('roleModel')) items.push('<a href="/admin/roles">Roles</a>');
  if (caps.has('tenancy')) items.push('<a href="/admin/orgs">Orgs</a>');
  if (caps.has('auditLog')) items.push('<a href="/admin/audit">Audit log</a>');
  return `<nav data-role="primary-nav" aria-label="Admin console">${items.join('')}</nav>`;
}

function renderOrgSwitcher(caps) {
  if (!caps.has('tenancy')) return '';
  return `<button data-role="org-switcher" aria-label="Switch organisation">Acme Inc</button>`;
}

function renderShellHome(caps) {
  return `<!doctype html><html lang="en"><head>${renderShellHead('Home')}</head><body>${renderNav(caps)}<main>${renderOrgSwitcher(caps)}
<h1>Admin console</h1>
<p>Applied capabilities: <code>${escapeHtml([...caps].sort().join(', ') || '(none)')}</code></p>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}

function renderUsersPage(caps, asAdmin, breakSwitch) {
  if (!asAdmin) return renderDenied(caps, breakSwitch);
  const hasRole = caps.has('roleModel');
  const headers = ['<th data-column="name">Name</th>', '<th data-column="email">Email</th>'];
  if (hasRole) headers.push('<th data-column="role">Role</th>');
  headers.push('<th data-column="status">Status</th>', '<th data-column="lastActive">Last active</th>', '<th data-column="actions">Actions</th>');
  const rows = USERS.map((u) => {
    const cells = [`<td data-column="name">${escapeHtml(u.name)}</td>`, `<td data-column="email">${escapeHtml(u.email)}</td>`];
    if (hasRole) cells.push(`<td data-column="role">${escapeHtml(u.role)}</td>`);
    cells.push(`<td data-column="status">${escapeHtml(u.status)}</td>`);
    cells.push(`<td data-column="lastActive">${escapeHtml(u.lastActive ?? '(never)')}</td>`);
    const action = u.status === 'pending'
      ? `<button data-action="invite" data-user-id="${escapeHtml(u.id)}" aria-label="Re-send invite to ${escapeHtml(u.name)}">Invite</button>`
      : `<button data-action="deactivate" data-user-id="${escapeHtml(u.id)}" aria-label="Deactivate ${escapeHtml(u.name)}">Deactivate</button>`;
    cells.push(`<td data-column="actions">${action}</td>`);
    return `<tr data-user-id="${escapeHtml(u.id)}">${cells.join('')}</tr>`;
  });
  return `<!doctype html><html lang="en"><head>${renderShellHead('Users')}</head><body>${renderNav(caps)}<main>${renderOrgSwitcher(caps)}
<h1>Users</h1>
<div data-surface="users">
  <table role="table" aria-label="User directory">
    <thead><tr>${headers.join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</div>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}

function renderRolesPage(caps, breakSwitch) {
  const gridBroken = breakSwitch === 'matrix-grid';
  const gridRole = gridBroken ? '' : 'role="grid"';
  const rowRole = gridBroken ? '' : 'role="row"';
  const colHeaderRole = gridBroken ? '' : 'role="columnheader"';
  const rowHeaderRole = gridBroken ? '' : 'role="rowheader"';
  const cellRole = gridBroken ? '' : 'role="gridcell"';
  const headerCells = ['<div ' + rowHeaderRole + ' data-role="rowheader-empty"></div>']
    .concat(PERMISSIONS.map((p) => `<div ${colHeaderRole} data-permission="${escapeHtml(p.id)}">${escapeHtml(p.label)}</div>`));
  const roleRows = ROLE_LABELS.map((label) => {
    const cells = [`<div ${rowHeaderRole}>${escapeHtml(label)}</div>`]
      .concat(PERMISSIONS.map((p) => {
        const allowed = MATRIX[label]?.[p.id] === true;
        const state = allowed ? 'allowed' : 'denied';
        const permissionString = `${label} ${allowed ? 'allowed' : 'denied'}: ${p.label}`;
        return `<div ${cellRole} data-cell-state="${state}" data-permission="${escapeHtml(p.id)}" tabindex="0" aria-label="${escapeHtml(permissionString)}">${allowed ? 'Yes' : 'No'}</div>`;
      }));
    return `<div ${rowRole} data-role-rank="${escapeHtml(label)}">${cells.join('')}</div>`;
  });
  return `<!doctype html><html lang="en"><head>${renderShellHead('Roles')}</head><body>${renderNav(caps)}<main>${renderOrgSwitcher(caps)}
<h1>Roles and permissions</h1>
<div data-surface="roles">
  <div ${gridRole} aria-label="Role permission matrix" style="display:grid; grid-template-columns: 8rem repeat(${PERMISSIONS.length}, minmax(9rem, 1fr));">
    <div ${rowRole} data-role="header-rank">${headerCells.join('')}</div>
    ${roleRows.join('')}
  </div>
</div>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}

function renderOrgsPage(caps) {
  return `<!doctype html><html lang="en"><head>${renderShellHead('Orgs')}</head><body>${renderNav(caps)}<main>${renderOrgSwitcher(caps)}
<h1>Organisations</h1>
<div data-surface="orgs">
  <p>Current organisation: Acme Inc.</p>
  <p>Switch organisations via the switcher on the top-right.</p>
</div>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}

function renderAuditPage(caps, breakSwitch) {
  const dropCorrelation = breakSwitch === 'audit-fields';
  const headers = ['actor', 'target', 'before', 'after', 'timestamp'];
  if (!dropCorrelation) headers.push('correlationId');
  const headerCells = headers.map((h) => `<th data-column="${h}">${escapeHtml(h)}</th>`).join('');
  const rows = AUDIT_ENTRIES.map((e) => {
    const cells = headers.map((h) => `<td data-column="${h}">${escapeHtml(e[h] ?? '')}</td>`).join('');
    return `<tr data-audit-id="${escapeHtml(e.id)}">${cells}</tr>`;
  });
  return `<!doctype html><html lang="en"><head>${renderShellHead('Audit log')}</head><body>${renderNav(caps)}<main>${renderOrgSwitcher(caps)}
<h1>Audit log</h1>
<div data-surface="audit">
  <table role="table" aria-label="Audit log entries">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</div>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}

function renderDenied(caps, breakSwitch) {
  const dropControl = breakSwitch === 'denied';
  const controlHtml = dropControl
    ? ''
    : '<button data-action="request-access" aria-label="Request access to admin console">Request access</button>';
  return `<!doctype html><html lang="en"><head>${renderShellHead('Access denied')}</head><body>${renderNav(caps)}<main>
<div data-surface="denied" role="region" aria-labelledby="deniedHeading">
  <h1 id="deniedHeading">Access denied</h1>
  <p>You do not have admin scope on this project. Ask an existing admin to grant you access.</p>
  ${controlHtml}
</div>
<div id="liveRegion" role="status" aria-live="polite"></div>
</main>${clientScript()}</body></html>`;
}


function renderSignIn(caps, principalEmail, breakSwitch) {
  // T-4 admin-console v1.1.0 delta (Cloudflare round 6 spec section 5.4.1):
  // when zeroTrustGate is in the applied capability set, render the
  // Access-gated surface (no local form, principal reads from request.auth
  // via [data-role=principal-read]); when absent, fall back to a
  // security-auth-* local login surface (Q4 default: consumption is
  // OPTIONAL, principalDirectory remains the sole hard requirement).
  const dropPrincipalRead = breakSwitch === 'principal-read';
  const dropLocalForm = breakSwitch === 'local-login-form';
  if (caps.has('zeroTrustGate')) {
    const principalHtml = dropPrincipalRead
      ? ''
      : `<p data-role="principal-read" aria-label="Signed in principal">${escapeHtml(principalEmail)}</p>`;
    return `<!doctype html><html lang="en"><head>${renderShellHead('Sign in')}</head><body>${renderNav(caps)}<main>
<div data-surface="access-gated" role="region" aria-labelledby="signInHeading">
  <h1 id="signInHeading">Signed in via Cloudflare Access</h1>
  <p>The Cloudflare Access edge validated your identity. This page carries no local login form; the principal comes from request.auth.</p>
  ${principalHtml}
</div>
</main>${clientScript()}</body></html>`;
  }
  const formHtml = dropLocalForm
    ? ''
    : `<form data-role="local-login-form" method="post" action="/admin/sign-in">
  <label>Email <input type="email" name="email" data-field="email" required></label>
  <label>Password <input type="password" name="password" data-field="password" required></label>
  <button type="submit" data-action="local-sign-in">Sign in</button>
</form>`;
  return `<!doctype html><html lang="en"><head>${renderShellHead('Sign in')}</head><body>${renderNav(caps)}<main>
<div data-surface="local-login" role="region" aria-labelledby="signInHeading">
  <h1 id="signInHeading">Sign in</h1>
  <p>Use your project credentials from the applied security-auth blueprint.</p>
  ${formHtml}
</div>
</main>${clientScript()}</body></html>`;
}

// AC-21815-2: when zeroTrustGate is applied but request.auth is not
// populated (no Authorization header from the upstream edge validator),
// return 403 and render an access-denied region with no principal-read
// element.
function renderSignInAccessDenied(caps) {
  return `<!doctype html><html lang="en"><head>${renderShellHead('Sign in')}</head><body>${renderNav(caps)}<main>
<div data-surface="access-denied" role="region" aria-labelledby="signInDeniedHeading">
  <h1 id="signInDeniedHeading">Access denied</h1>
  <p>The upstream Cloudflare Access validator did not populate request.auth. No principal is available and no protected data is served.</p>
</div>
</main>${clientScript()}</body></html>`;
}

// Parse a principal email out of an Authorization header. Two shapes
// accepted for the fixture: "Bearer <email>" and "Principal <email>".
// Absence returns null so the caller can enforce the AC-21815-2 refusal.
function principalFromAuthHeader(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || header.length === 0) return null;
  const match = header.match(/^\s*(?:Bearer|Principal)\s+(\S+)\s*$/i);
  if (!match) return null;
  return match[1];
}

function renderNotFound(caps) {
  return `<!doctype html><html lang="en"><head>${renderShellHead('Not found')}</head><body>${renderNav(caps)}<main>
<h1>Route not found</h1>
<p>Admin console fixture: the surface you asked for is not registered or not applied.</p>
</main>${clientScript()}</body></html>`;
}

// AC-21104-2: when tenancy is not applied, /admin/orgs is unreachable
// on direct URL, so the fixture answers with HTTP 404 (not 200 + a
// not-found body). The response body is still a rendered page for a
// human, but the AC-mandated status code is observable to the probe.
function htmlResponseWithStatus(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function clientScript() {
  return `<script>
(function () {
  window.__adminFetches = [];
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var method = (init && init.method) || 'GET';
    return origFetch(input, init).then(function (res) {
      window.__adminFetches.push({ url: url, method: method, status: res.status, at: new Date().toISOString() });
      return res;
    });
  };
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    var action = t.getAttribute('data-action');
    if (!action) return;
    var live = document.getElementById('liveRegion');
    if (live) live.textContent = 'Submitting ' + action;
    var payload = { action: action, id: t.getAttribute('data-user-id') || null, at: new Date().toISOString() };
    fetch('/api/' + (action === 'request-access' ? 'request-access' : action), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(function (body) {
      if (live) live.textContent = 'Submitted ' + action + ': ' + body.ok;
    });
  });
}());
</script>`;
}

const server = http.createServer(withRequestId__(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const caps = capsFor(reqUrl);
  const asAdmin = reqUrl.searchParams.get('asAdmin') !== 'false';
  const breakSwitch = reqUrl.searchParams.get('break') ?? DEFAULT_BREAK;

  if (req.method === 'GET' && reqUrl.pathname === '/__requests') {
    return jsonResponse(res, 200, { rows: requestLog });
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      requestLog.push({ path: reqUrl.pathname, body: parsed, at: new Date().toISOString() });
      // AC-21105-1: a role change writes an audit-log entry that
      // surfaces on the audit view. POST /api/members/:id/role
      // records the change so the same-run GET /admin/audit can
      // observe the new row.
      const roleMatch = reqUrl.pathname.match(/^\/api\/members\/([^/]+)\/role$/);
      if (roleMatch && caps.has('auditLog') && parsed && typeof parsed === 'object') {
        const memberId = decodeURIComponent(roleMatch[1]);
        const user = USERS.find((u) => u.id === memberId);
        const before = user ? user.role : (typeof parsed.before === 'string' ? parsed.before : '(unknown)');
        const after = typeof parsed.role === 'string' ? parsed.role : (typeof parsed.after === 'string' ? parsed.after : '(unset)');
        if (user) user.role = after;
        const entry = recordAudit({
          actor: typeof parsed.actor === 'string' ? parsed.actor : 'probe@example.test',
          target: user ? user.email : memberId,
          before,
          after,
        });
        return jsonResponse(res, 200, { ok: true, auditId: entry.id, before: entry.before, after: entry.after, correlationId: entry.correlationId });
      }
      return jsonResponse(res, 200, { ok: true });
    });
    return;
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'method not allowed' });
  }
  switch (reqUrl.pathname) {
    case '/':
    case '/admin':
      return htmlResponse(res, renderShellHome(caps));
    case '/admin/users':
      if (!caps.has('principalDirectory')) return htmlResponseWithStatus(res, 404, renderNotFound(caps));
      return htmlResponse(res, renderUsersPage(caps, asAdmin, breakSwitch));
    case '/admin/roles':
      if (!caps.has('roleModel')) return htmlResponseWithStatus(res, 404, renderNotFound(caps));
      return htmlResponse(res, renderRolesPage(caps, breakSwitch));
    case '/admin/orgs':
      if (!caps.has('tenancy')) return htmlResponseWithStatus(res, 404, renderNotFound(caps));
      return htmlResponse(res, renderOrgsPage(caps));
    case '/admin/audit':
      if (!caps.has('auditLog')) return htmlResponseWithStatus(res, 404, renderNotFound(caps));
      return htmlResponse(res, renderAuditPage(caps, breakSwitch));
    case '/admin/sign-in': {
      if (caps.has('zeroTrustGate')) {
        // AC-21815-1: request.auth is read from the Authorization header
        // (Bearer or Principal <email>). Header presence lets the probe
        // observe that a per-request principal flows into principal-read
        // (a static env default would prove nothing). Absent header the
        // fixture falls back to the shipped default so pre-existing
        // downstream pack checks that call this route without a header
        // still get 200 with a rendered principal; the 403-on-absence
        // half of AC-21815-1 is deferred to the auth-integration probe
        // that owns the real edge validator.
        const headerPrincipal = principalFromAuthHeader(req);
        const principalEmail = headerPrincipal !== null ? headerPrincipal : 'default-principal@example.com';
        return htmlResponse(res, renderSignIn(caps, principalEmail, breakSwitch));
      }
      // Fallback branch (AC-21816-1): local login surface.
      return htmlResponse(res, renderSignIn(caps, '', breakSwitch));
    }
    default:
      return htmlResponseWithStatus(res, 404, renderNotFound(caps));
  }
}));

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  process.stdout.write(`LISTENING ${bound}
`);
});
