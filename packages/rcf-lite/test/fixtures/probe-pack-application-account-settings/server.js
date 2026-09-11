// Dependency-free sample app for the application-account-settings blueprint
// probe pack. Framework-free by design: one Node HTTP server, one shell
// HTML per surface, one inline client script.
//
// Environment:
//   PORT                              HTTP port (default 3000). Never bind 4200.
//   ACCOUNT_SETTINGS_CAPS             Comma-separated capability list mirroring
//                                     manifest.blueprints[<slug>].appliedCapabilities.
//                                     Default: principalDirectory.
//   ACCOUNT_SETTINGS_APPS             Comma-separated applied-blueprint slug list
//                                     mirroring the notifications-in-app and spa
//                                     gating. Default: (empty).
//   ACCOUNT_SETTINGS_SECURITY_SHAPE   Elicited security-surface-shape.
//                                     Default: self-service. Values: self-service,
//                                     hosted-link-out, hosted-embed.
//   ACCOUNT_SETTINGS_HOSTED_URL       Elicited hosted-identity-url.
//                                     Default: https://hosted.example.com/account.
//   ACCOUNT_SETTINGS_THEME_PERSIST    Elicited theme-persistence.
//                                     Default: spa-local-storage.
//
// Query switches:
//   ?caps=<list>                   Override caps for one page load.
//   ?apps=<list>                   Override apps for one page load.
//   ?security-surface-shape=<s>    Override security shape.
//   ?theme-persistence=<s>         Override theme persistence.
//   ?provider=<clerk|keycloak|oauth2>  Label the applied auth provider
//                                  supplying sessionInventory for the
//                                  AC-25106-1 uniform-render contract
//                                  observation. Sessions surface emits
//                                  <meta data-observed-provider="X"> so a
//                                  probe can verify the render contract is
//                                  identical regardless of the applied
//                                  auth blueprint. Ignored when
//                                  sessionInventory is not in caps.
//   ?authed=false                  Simulate an unauthenticated principal
//                                  (renders the forbidden state from T-1).
//   ?break=leak-tab                Render the security tab even when neither
//                                  credentialSelfService nor hostedIdentityUi
//                                  is applied (suppression check fails).
//   ?break=no-autocomplete         Drop autocomplete tokens on the profile form.
//   ?break=no-dialog               Skip the ARIA dialog-modal on session
//                                  terminate.
//   ?break=no-persist              Drop the theme persistence write.

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
const DEFAULT_CAPS = String(process.env.ACCOUNT_SETTINGS_CAPS ?? 'principalDirectory');
const DEFAULT_APPS = String(process.env.ACCOUNT_SETTINGS_APPS ?? '');
const DEFAULT_SECURITY_SHAPE = String(process.env.ACCOUNT_SETTINGS_SECURITY_SHAPE ?? 'self-service');
const DEFAULT_HOSTED_URL = String(process.env.ACCOUNT_SETTINGS_HOSTED_URL ?? 'https://hosted.example.com/account');
const DEFAULT_THEME_PERSIST = String(process.env.ACCOUNT_SETTINGS_THEME_PERSIST ?? 'spa-local-storage');

function csvSet(csv) {
  return new Set(String(csv || '').split(',').map((s) => s.trim()).filter(Boolean));
}

function parseQuery(url) {
  const q = url.searchParams;
  const caps = csvSet(q.get('caps') ?? DEFAULT_CAPS);
  const apps = csvSet(q.get('apps') ?? DEFAULT_APPS);
  const securityShape = q.get('security-surface-shape') ?? DEFAULT_SECURITY_SHAPE;
  const themePersist = q.get('theme-persistence') ?? DEFAULT_THEME_PERSIST;
  const authed = q.get('authed') !== 'false';
  const breakSwitch = q.get('break') ?? process.env.PROBE_BREAK ?? '';
  const providerRaw = q.get('provider');
  const provider = ['clerk', 'keycloak', 'oauth2'].includes(providerRaw) ? providerRaw : null;
  return { caps, apps, securityShape, themePersist, authed, breakSwitch, provider };
}

function shellTabs({ caps, apps, breakSwitch }) {
  const tabs = [
    { id: 'profile', label: 'Profile', href: '/account/profile', always: true },
    { id: 'security', label: 'Security', href: '/account/security', show: (breakSwitch === 'leak-tab') || caps.has('credentialSelfService') || caps.has('hostedIdentityUi') },
    { id: 'sessions', label: 'Sessions', href: '/account/sessions', show: caps.has('sessionInventory') },
    { id: 'notifications', label: 'Notifications', href: '/account/notifications', show: apps.has('application-notifications-in-app') },
    { id: 'theme', label: 'Theme', href: '/account/theme', show: apps.has('application-spa') },
  ];
  return tabs.filter((t) => t.always || t.show);
}

function page(title, bodyHtml, initialTheme) {
  const theme = initialTheme || 'light';
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1rem; }
  nav[data-role="account-settings-nav"] { display: flex; gap: 0.5rem; border-bottom: 1px solid #ccc; }
  nav[data-role="account-settings-nav"] a { padding: 0.5rem 1rem; text-decoration: none; }
  form[data-surface="profile"] label { display: block; margin: 0.5rem 0; }
  table { border-collapse: collapse; margin-top: 1rem; }
  table td, table th { border: 1px solid #ccc; padding: 0.25rem 0.5rem; }
  [role="dialog"] { border: 2px solid #333; padding: 1rem; background: white; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function renderShell(surface, inner, ctx) {
  const tabs = shellTabs(ctx);
  const links = tabs.map((t) => `<a role="tab" data-tab-id="${t.id}" href="${t.href}"${t.id === surface ? ' aria-selected="true"' : ''}>${t.label}</a>`).join('');
  return `
<h1>Account settings</h1>
<nav data-role="account-settings-nav" aria-label="Account settings" role="tablist">${links}</nav>
<main role="tabpanel">${inner}</main>`;
}

function forbiddenState() {
  // Composes on application-empty-error-states T-1 forbidden state contract.
  return page('Account settings', `
<div data-surface="forbidden" role="alert">
  <h1>Sign in required</h1>
  <p>You need to sign in to reach your account.</p>
  <a data-action="sign-in" href="/sign-in">Sign in</a>
</div>`);
}

function profileSurface({ breakSwitch }) {
  const autocomplete = breakSwitch === 'no-autocomplete';
  const auto = (token) => autocomplete ? '' : ` autocomplete="${token}"`;
  return `
<h2>Profile</h2>
<form data-surface="profile" method="post" action="/account/profile">
  <label>Full name <input type="text" name="name"${auto('name')}></label>
  <label>Email <input type="email" name="email"${auto('email')}></label>
  <label>Birthday <input type="date" name="bday"${auto('bday')}></label>
  <label>Country <input type="text" name="country"${auto('country')}></label>
  <button type="submit">Save</button>
  <div role="status" aria-live="polite" data-role="save-status">Profile saved</div>
</form>`;
}

function securitySurface({ caps, securityShape, breakSwitch }) {
  const showLeak = breakSwitch === 'leak-tab' && !caps.has('credentialSelfService') && !caps.has('hostedIdentityUi');
  if (showLeak) {
    return `
<h2>Security</h2>
<div data-surface="security" data-branch="leaked">
  <p>Manage your credentials.</p>
</div>`;
  }
  if (!caps.has('credentialSelfService') && !caps.has('hostedIdentityUi')) return '<h2>Security</h2><p>Security surface is not applied on this project.</p>';
  if (caps.has('credentialSelfService') && securityShape === 'self-service') {
    return `
<h2>Security</h2>
<div data-surface="security" data-branch="self-service">
  <form data-role="change-password" action="/api/change-password" method="post">
    <label>Current password <input type="password" name="current" autocomplete="current-password"></label>
    <label>New password <input type="password" name="next" autocomplete="new-password"></label>
    <button type="submit">Change password</button>
  </form>
  <section data-role="mfa-management">
    <h3>Multi-factor authentication</h3>
    <button type="button" data-action="enroll-mfa">Enroll authenticator</button>
  </section>
</div>`;
  }
  if (caps.has('hostedIdentityUi') && securityShape === 'hosted-link-out') {
    return `
<h2>Security</h2>
<div data-surface="security" data-branch="hosted-link-out">
  <a data-role="hosted-link-out" href="${DEFAULT_HOSTED_URL}" rel="noopener">Manage security at the hosted provider</a>
</div>`;
  }
  if (caps.has('hostedIdentityUi') && securityShape === 'hosted-embed') {
    return `
<h2>Security</h2>
<div data-surface="security" data-branch="hosted-embed">
  <iframe data-role="hosted-embed" title="Account security" src="${DEFAULT_HOSTED_URL}" sandbox="allow-scripts allow-forms allow-same-origin" width="800" height="600"></iframe>
</div>`;
  }
  return `<h2>Security</h2><p>Security surface shape not resolved for the applied capability set.</p>`;
}

// AC-25106-1 adapter contract: each applied auth provider ships a
// distinct raw inventory payload (different device labels, different
// timestamp shapes, different current-session markers). The fixture
// adapter normalises each raw payload into the common session-row
// shape a probe can prove is uniform across providers. The three
// distinct raw payloads are declared inline so a probe can vary the
// provider input and confirm the derived shape is identical even
// though the underlying inventories are not.
const PROVIDER_RAW_INVENTORIES = {
  clerk: [
    { session_id: 'clerk-s-01', ua: 'MacBook Pro (Safari)', last_seen_iso: '2026-09-06T20:14:00Z', is_this_session: true },
    { session_id: 'clerk-s-02', ua: 'iPhone 15 (Mobile Safari)', last_seen_iso: '2026-09-06T18:02:00Z', is_this_session: false },
    { session_id: 'clerk-s-03', ua: 'Ubuntu 24.04 (Firefox)', last_seen_iso: '2026-09-05T22:41:00Z', is_this_session: false },
  ],
  keycloak: [
    { sid: 'kc.session.a1', client: 'Windows 11 (Edge)', lastAccessed: 1725570000000, active: true },
    { sid: 'kc.session.b2', client: 'Android 14 (Chrome)', lastAccessed: 1725462000000, active: false },
  ],
  oauth2: [
    { tokenSubject: 'sub-oauth-001', deviceLabel: 'ChromeOS (Chrome)', issuedAt: '2026-09-06T15:30:00Z', currentDevice: true },
    { tokenSubject: 'sub-oauth-002', deviceLabel: 'macOS (Firefox)', issuedAt: '2026-09-04T09:15:00Z', currentDevice: false },
    { tokenSubject: 'sub-oauth-003', deviceLabel: 'iPad (Safari)', issuedAt: '2026-09-03T22:00:00Z', currentDevice: false },
    { tokenSubject: 'sub-oauth-004', deviceLabel: 'Windows (Firefox)', issuedAt: '2026-09-02T18:20:00Z', currentDevice: false },
  ],
};

const ADAPTERS = {
  clerk(raw) {
    return raw.map((r) => ({ id: r.session_id, device: r.ua, lastActive: r.last_seen_iso, current: r.is_this_session === true }));
  },
  keycloak(raw) {
    return raw.map((r) => ({ id: r.sid, device: r.client, lastActive: new Date(r.lastAccessed).toISOString(), current: r.active === true }));
  },
  oauth2(raw) {
    return raw.map((r) => ({ id: r.tokenSubject, device: r.deviceLabel, lastActive: r.issuedAt, current: r.currentDevice === true }));
  },
};

// Default (no provider selected) preserves the shipped s1/s2/s3
// three-row shape so pre-existing anatomy tests and pack calls that
// do not name a provider observe the same DOM they did before the
// per-provider adapter contract was added.
const DEFAULT_SESSIONS = [
  { id: 's1', device: 'MacBook Pro (Safari)', lastActive: '2026-09-06T20:14:00Z', current: true },
  { id: 's2', device: 'iPhone 15 (Mobile Safari)', lastActive: '2026-09-06T18:02:00Z', current: false },
  { id: 's3', device: 'Ubuntu 24.04 (Firefox)', lastActive: '2026-09-05T22:41:00Z', current: false },
];

function sessionsSurface({ caps, breakSwitch, provider }) {
  if (!caps.has('sessionInventory')) return '<h2>Sessions</h2><p>Sessions surface is not applied on this project.</p>';
  const rows = provider ? ADAPTERS[provider](PROVIDER_RAW_INVENTORIES[provider]) : DEFAULT_SESSIONS;
  const trs = rows.map((r) => `
<tr data-session-id="${r.id}"${r.current ? ' data-current-session="true"' : ''}>
  <td data-column="device">${r.device}</td>
  <td data-column="lastActive">${r.lastActive}</td>
  <td>${r.current ? '<em>Current session</em>' : `<button type="button" data-action="terminate" data-target-session="${r.id}">Terminate</button>`}</td>
</tr>`).join('');
  const dialog = breakSwitch === 'no-dialog' ? '' : `
<div role="dialog" aria-modal="true" data-role="terminate-confirm" aria-labelledby="terminate-confirm-heading" hidden>
  <h3 id="terminate-confirm-heading">End session?</h3>
  <p>Sign this device out immediately.</p>
  <button type="button" data-action="terminate-confirm">Yes, end session</button>
  <button type="button" data-action="terminate-cancel">Cancel</button>
</div>`;
  // AC-25106-1: the sessions render contract is identical regardless of
  // which applied auth blueprint supplied sessionInventory. The optional
  // provider label rides in as a stripped-on-normalise meta tag so a
  // probe can vary the provider input, observe the label was honoured,
  // and prove the derived DOM shape is byte-identical across providers.
  const providerMeta = provider ? `<meta data-observed-provider="${provider}">` : '';
  return `
<h2>Sessions</h2>
<div data-surface="sessions">
  ${providerMeta}
  <table>
    <thead><tr><th>Device</th><th>Last active</th><th>Action</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>
  ${dialog}
  <div role="status" aria-live="polite" data-role="session-terminated-announce"></div>
</div>`;
}

function notificationsSurface({ apps }) {
  if (!apps.has('application-notifications-in-app')) return '<h2>Notifications</h2><p>Notification preferences require the application-notifications-in-app blueprint.</p>';
  return `
<h2>Notification preferences</h2>
<div data-surface="notifications">
  <fieldset><legend>Categories</legend>
    <label data-role="category-silence"><input type="checkbox" name="cat-account"> Silence account category</label>
    <label data-role="category-silence"><input type="checkbox" name="cat-security"> Silence security category</label>
  </fieldset>
  <fieldset><legend>Channels</legend>
    <label data-role="channel-opt-in"><input type="checkbox" name="ch-in-app" checked> In-app</label>
    <label data-role="channel-opt-in"><input type="checkbox" name="ch-email" checked> Email</label>
  </fieldset>
  <div role="status" aria-live="polite" data-role="save-status">Preferences saved</div>
</div>`;
}

// AC-25108-1 server-scoped-persistence half: when the applied theme
// persistence store is 'server-scoped', the fixture holds a
// per-principal server-side theme record. POST /api/theme?theme=X
// writes it; subsequent GET /account/theme reflects that written
// value on the html element data-theme attribute (initial load,
// no browser JS involved) and pre-selects the matching radio.
// Principal defaults to a single-tenant fixture default when no
// X-Principal-Id header is sent (probes can vary it explicitly).
const serverScopedThemeStore = new Map();

function serverScopedThemeFor(principalId) {
  return serverScopedThemeStore.get(principalId) || null;
}

function themeSurface({ apps, themePersist, breakSwitch, principalId }) {
  if (!apps.has('application-spa')) return '<h2>Theme</h2><p>Theme surface requires the application-spa blueprint.</p>';
  const stored = themePersist === 'server-scoped' ? serverScopedThemeFor(principalId) : null;
  const initial = stored || 'light';
  const checked = (v) => v === initial ? ' checked' : '';
  const persistScript = breakSwitch === 'no-persist' || themePersist === 'server-scoped' ? '' : `
<script>
document.querySelectorAll('input[name="theme"]').forEach((el) => {
  el.addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
    try {
      if (${JSON.stringify(themePersist === 'spa-local-storage')}) window.localStorage.setItem('account-settings:theme', e.target.value);
    } catch (err) { /* private-mode */ }
  });
});
</script>`;
  return `
<h2>Theme</h2>
<div data-surface="theme" role="radiogroup" aria-label="Theme" data-persist="${themePersist}" data-server-scoped-theme="${stored || ''}">
  <label><input type="radio" name="theme" value="light"${checked('light')}> Light</label>
  <label><input type="radio" name="theme" value="dark"${checked('dark')}> Dark</label>
  <label><input type="radio" name="theme" value="system"${checked('system')}> System</label>
</div>
${persistScript}`;
}

function readPrincipalId(req, url) {
  const header = req.headers['x-principal-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const q = url.searchParams.get('principal-id');
  return typeof q === 'string' && q.length > 0 ? q : 'fixture-default-principal';
}

function themePage(ctx, principalId) {
  const stored = ctx.themePersist === 'server-scoped' ? serverScopedThemeFor(principalId) : null;
  const initial = stored || 'light';
  return page('Theme', renderShell('theme', themeSurface({ ...ctx, principalId }), ctx), initial);
}

const server = http.createServer(withRequestId__((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const ctx = parseQuery(url);
  const path = url.pathname;
  const send = (status, body, mime = 'text/html; charset=utf-8') => {
    res.statusCode = status;
    res.setHeader('content-type', mime);
    res.end(body);
  };
  const principalId = readPrincipalId(req, url);

  // AC-25108-1 server-scoped write endpoint: POST /api/theme?theme=X
  // stores the theme per principal. Only writes when the applied
  // theme-persistence store is 'server-scoped'. Returns the stored
  // record so a probe can observe the write independent of the
  // subsequent GET.
  if (req.method === 'POST' && path === '/api/theme') {
    if (ctx.themePersist !== 'server-scoped') {
      return send(409, JSON.stringify({ error: 'theme-persistence is not server-scoped', persist: ctx.themePersist }), 'application/json; charset=utf-8');
    }
    const chosen = url.searchParams.get('theme');
    if (!['light', 'dark', 'system'].includes(chosen)) {
      return send(400, JSON.stringify({ error: 'invalid theme', theme: chosen }), 'application/json; charset=utf-8');
    }
    serverScopedThemeStore.set(principalId, chosen);
    return send(200, JSON.stringify({ ok: true, principalId, theme: chosen }), 'application/json; charset=utf-8');
  }
  if (req.method === 'DELETE' && path === '/api/theme') {
    serverScopedThemeStore.delete(principalId);
    return send(200, JSON.stringify({ ok: true, principalId }), 'application/json; charset=utf-8');
  }

  if (!ctx.authed) return send(200, forbiddenState());
  if (path === '/account' || path === '/account/') return send(200, page('Account settings', renderShell('profile', profileSurface(ctx), ctx)));
  if (path === '/account/profile') return send(200, page('Profile', renderShell('profile', profileSurface(ctx), ctx)));
  if (path === '/account/security') return send(200, page('Security', renderShell('security', securitySurface(ctx), ctx)));
  if (path === '/account/sessions') return send(200, page('Sessions', renderShell('sessions', sessionsSurface(ctx), ctx)));
  if (path === '/account/notifications') return send(200, page('Notifications', renderShell('notifications', notificationsSurface(ctx), ctx)));
  if (path === '/account/theme') return send(200, themePage(ctx, principalId));
  return send(404, page('Not found', '<h1>Not found</h1>'));
}));

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`LISTENING ${PORT}\n`);
});
