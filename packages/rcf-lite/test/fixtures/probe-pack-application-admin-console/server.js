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
import { URL } from 'node:url';

const DEFAULT_CAPS = process.env.ADMIN_CONSOLE_CAPS ?? 'principalDirectory,roleModel,auditLog';

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

function renderNotFound(caps) {
  return `<!doctype html><html lang="en"><head>${renderShellHead('Not found')}</head><body>${renderNav(caps)}<main>
<h1>Route not found</h1>
<p>Admin console fixture: the surface you asked for is not registered or not applied.</p>
</main>${clientScript()}</body></html>`;
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

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const caps = capsFor(reqUrl);
  const asAdmin = reqUrl.searchParams.get('asAdmin') !== 'false';
  const breakSwitch = reqUrl.searchParams.get('break');

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
      if (!caps.has('principalDirectory')) return htmlResponse(res, renderNotFound(caps));
      return htmlResponse(res, renderUsersPage(caps, asAdmin, breakSwitch));
    case '/admin/roles':
      if (!caps.has('roleModel')) return htmlResponse(res, renderNotFound(caps));
      return htmlResponse(res, renderRolesPage(caps, breakSwitch));
    case '/admin/orgs':
      if (!caps.has('tenancy')) return htmlResponse(res, renderNotFound(caps));
      return htmlResponse(res, renderOrgsPage(caps));
    case '/admin/audit':
      if (!caps.has('auditLog')) return htmlResponse(res, renderNotFound(caps));
      return htmlResponse(res, renderAuditPage(caps, breakSwitch));
    default:
      return htmlResponse(res, renderNotFound(caps));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // Contract: emit LISTENING once bound so a caller can grep for it.
  process.stdout.write(`LISTENING ${port}\n`);
});
