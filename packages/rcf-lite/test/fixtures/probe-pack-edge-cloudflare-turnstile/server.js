// Dependency-free sample app for the edge-cloudflare-turnstile blueprint
// probe pack. Framework-free by design: one Node HTTP server, an inline
// client script that mounts the Cloudflare Turnstile widget, a
// server-side POST to https://challenges.cloudflare.com/turnstile/v0/siteverify,
// a refuse-if-token-missing guard on every elicited surface, and a
// magic-link mint stub route composed with the same guard.
//
// Environment (all Turnstile keys are the PUBLIC test keys documented at
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
//   PORT                          HTTP port (default 3000). Never binds 4200.
//   TURNSTILE_SITEKEY             Client widget sitekey. Default: 1x00000000000000000000AA (always passes).
//   TURNSTILE_SECRET              Server-side secret. Default: 1x0000000000000000000000000000000AA (always passes).
//   TURNSTILE_INVISIBLE_SITEKEY   Invisible-widget test sitekey. Default: 1x00000000000000000000BB.
//   TURNSTILE_BLOCK_SITEKEY       Always-block test sitekey. Default: 2x00000000000000000000AB.
//   TURNSTILE_FORCED_SITEKEY      Forced-interactive test sitekey. Default: 3x00000000000000000000FF.
//   TURNSTILE_FAIL_SECRET         Always-fail test secret. Default: 2x0000000000000000000000000000000AA.
//   TURNSTILE_WIDGET_MODE         Default widget mode (managed | non-interactive | invisible). Default: managed.
//   TURNSTILE_GUARDED_SURFACES    Comma-separated route paths guarded. Default: /api/submit,/api/magic-link.
//   SITEVERIFY_URL                Override endpoint for offline probes. Default: https://challenges.cloudflare.com/turnstile/v0/siteverify.
//
// Query switches (per-page-load overrides):
//   ?sitekey=<pass|block|forced|invisible-pass|invisible-block>  select sitekey.
//   ?mode=<managed|non-interactive|invisible>                    select widget mode.
//   ?break=missing-token         strip the token before submit (guard branch surfaces 400).
//   ?break=other-origin          mount an additional script from a non-Cloudflare host (widgetRendered check surfaces third-party fail).
//   ?fail-secret=1               force the server to use TURNSTILE_FAIL_SECRET for the next POST (drives serverVerified-fail without re-booting the fixture).
//
// Routes:
//   GET  /                       Public contact form (mounts Turnstile widget).
//   GET  /magic-link             Magic-link mint form (composed with Turnstile guard).
//   POST /api/submit             Server-side siteverify + handler. 200 on pass, 400 on fail.
//   POST /api/magic-link         Magic-link mint stub. Refused with 400 without valid Turnstile response.
//   GET  /api/events             Event sink dump (JSON), for the event-secrecy probe.
//   POST /api/events/clear       Clear the event sink.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT ?? 3000);
if (PORT === 4200) {
  console.error('refusing to bind PORT=4200 (workspace server owns that port)');
  process.exit(2);
}

const DEFAULT_SITEKEY = String(process.env.TURNSTILE_SITEKEY ?? '1x00000000000000000000AA');
const DEFAULT_SECRET = String(process.env.TURNSTILE_SECRET ?? '1x0000000000000000000000000000000AA');
const INVISIBLE_PASS_SITEKEY = String(process.env.TURNSTILE_INVISIBLE_SITEKEY ?? '1x00000000000000000000BB');
const INVISIBLE_BLOCK_SITEKEY = String(process.env.TURNSTILE_INVISIBLE_BLOCK_SITEKEY ?? '2x00000000000000000000BB');
const BLOCK_SITEKEY = String(process.env.TURNSTILE_BLOCK_SITEKEY ?? '2x00000000000000000000AB');
const FORCED_SITEKEY = String(process.env.TURNSTILE_FORCED_SITEKEY ?? '3x00000000000000000000FF');
const FAIL_SECRET = String(process.env.TURNSTILE_FAIL_SECRET ?? '2x0000000000000000000000000000000AA');
const DEFAULT_MODE = String(process.env.TURNSTILE_WIDGET_MODE ?? 'managed');
const GUARDED_SURFACES = String(process.env.TURNSTILE_GUARDED_SURFACES ?? '/api/submit,/api/magic-link')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SITEVERIFY_URL = String(process.env.SITEVERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
const CLOUDFLARE_TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

const EVENT_SINK = [];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sitekeyFor(name) {
  switch (name) {
    case 'block': return BLOCK_SITEKEY;
    case 'forced': return FORCED_SITEKEY;
    case 'invisible-pass': return INVISIBLE_PASS_SITEKEY;
    case 'invisible-block': return INVISIBLE_BLOCK_SITEKEY;
    case 'pass':
    default: return DEFAULT_SITEKEY;
  }
}

function pickMode(q) {
  const m = q.get('mode');
  if (m && ['managed', 'non-interactive', 'invisible'].includes(m)) return m;
  return DEFAULT_MODE;
}

function hashSitekey(sitekey) {
  return createHash('sha256').update(String(sitekey)).digest('hex').slice(0, 12);
}

function recordEvent(record) {
  // Every event record ships with metadata-only keys per ADR-3603.
  const frozen = Object.freeze({
    sitekeyHash: record.sitekeyHash,
    outcome: record.outcome,
    timestamp: new Date().toISOString(),
  });
  EVENT_SINK.push(frozen);
}

function refuse(res, status, code, extra) {
  res.writeHead(status, { 'content-type': 'application/json' });
  const body = { errorCode: code };
  if (extra && extra.errorCodes) body.errorCodes = extra.errorCodes;
  res.end(JSON.stringify(body));
}

function tokenRequiredGuard(req, res, params) {
  // Registered on every guarded surface. Reads Cf-Turnstile-Response only via params.
  // Sole reader of the payload field per TAC-3602.
  const token = params.get('cf-turnstile-response');
  if (!token || token.length === 0) {
    recordEvent({ sitekeyHash: hashSitekey(params.get('turnstile-sitekey') || DEFAULT_SITEKEY), outcome: 'missing' });
    refuse(res, 400, 'turnstile.token-missing');
    return false;
  }
  return true;
}

async function siteverify(token, secret) {
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  const resp = await fetch(SITEVERIFY_URL, { method: 'POST', body });
  const json = await resp.json();
  return json;
}

function widgetMountScript(sitekey, mode, breakOtherOrigin) {
  const otherOriginPin = breakOtherOrigin
    ? `<script src="https://example.com/not-cloudflare.js"><\/script>`
    : '';
  return `
${otherOriginPin}
<script src="${CLOUDFLARE_TURNSTILE_JS}" async defer><\/script>
<div class="cf-turnstile"
     data-role="turnstile-widget"
     data-sitekey="${esc(sitekey)}"
     data-appearance="${mode === 'invisible' ? 'always' : 'always'}"
     data-size="${mode === 'invisible' ? 'invisible' : 'normal'}"
     data-callback="onTurnstileToken"></div>
<script>
window.onTurnstileToken = function (token) {
  var f = document.querySelector('form[data-role="turnstile-form"]');
  if (!f) return;
  var i = f.querySelector('input[name="cf-turnstile-response"]');
  if (!i) {
    i = document.createElement('input');
    i.type = 'hidden';
    i.name = 'cf-turnstile-response';
    f.appendChild(i);
  }
  i.value = token;
};
<\/script>
`;
}

function pageHtml({ path, sitekey, mode, breakSwitch }) {
  const stripToken = breakSwitch === 'missing-token';
  const otherOrigin = breakSwitch === 'other-origin';
  const formAction = path === '/magic-link' ? '/api/magic-link' : '/api/submit';
  const heading = path === '/magic-link' ? 'Magic-link mint (Turnstile-guarded)' : 'Public contact form (Turnstile-guarded)';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(heading)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1rem; max-width: 40rem; }
form { border: 1px solid #ccc; padding: 1rem; }
.cf-turnstile { margin: 1rem 0; }
</style>
</head>
<body>
<h1 data-role="page-heading">${esc(heading)}</h1>
<p>
Sitekey: <code data-role="sitekey">${esc(sitekey)}</code>. Mode: <code data-role="mode">${esc(mode)}</code>.
${otherOrigin ? '<strong data-role="break">break=other-origin</strong>' : ''}
${stripToken ? '<strong data-role="break">break=missing-token</strong>' : ''}
</p>
<form data-role="turnstile-form" method="post" action="${esc(formAction)}" enctype="application/x-www-form-urlencoded">
  <label>Email <input type="email" name="email" value="reviewer@example.com" required></label><br><br>
  ${widgetMountScript(sitekey, mode, otherOrigin)}
  <input type="hidden" name="turnstile-sitekey" value="${esc(sitekey)}">
  <input type="hidden" name="turnstile-mode" value="${esc(mode)}">
  ${stripToken ? '' : '<!-- token populated on submit by Turnstile onTurnstileToken -->'}
  <button type="submit" data-action="submit">Submit</button>
</form>
</body>
</html>`;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseParams(req, raw) {
  const type = String(req.headers['content-type'] || '');
  if (type.startsWith('application/x-www-form-urlencoded')) return new URLSearchParams(raw);
  if (type.startsWith('application/json')) {
    try {
      const p = new URLSearchParams();
      const j = JSON.parse(raw || '{}');
      for (const [k, v] of Object.entries(j)) p.set(k, String(v));
      return p;
    } catch { return new URLSearchParams(); }
  }
  return new URLSearchParams(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const q = url.searchParams;

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/magic-link')) {
      const sitekey = sitekeyFor(q.get('sitekey') || 'pass');
      const mode = pickMode(q);
      const breakSwitch = q.get('break') || '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml({ path: url.pathname, sitekey, mode, breakSwitch }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      json(res, 200, EVENT_SINK.slice());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/events/clear') {
      EVENT_SINK.length = 0;
      json(res, 200, { cleared: true });
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/api/submit' || url.pathname === '/api/magic-link')) {
      const raw = await readBody(req);
      const params = parseParams(req, raw);
      if (!GUARDED_SURFACES.includes(url.pathname)) {
        json(res, 500, { errorCode: 'turnstile.guard-misregistered' });
        return;
      }
      if (!tokenRequiredGuard(req, res, params)) return;
      const token = params.get('cf-turnstile-response');
      const sitekey = params.get('turnstile-sitekey') || DEFAULT_SITEKEY;
      // Failure-secret switch is per-request so tests do not need to reboot the fixture.
      const useFailSecret = q.get('fail-secret') === '1' || params.get('fail-secret') === '1';
      const secret = useFailSecret ? FAIL_SECRET : DEFAULT_SECRET;
      const verdict = await siteverify(token, secret);
      const outcome = verdict.success ? (url.pathname === '/api/magic-link' ? 'minted' : 'verified') : 'refused';
      recordEvent({ sitekeyHash: hashSitekey(sitekey), outcome });
      if (!verdict.success) {
        refuse(res, 400, 'turnstile.siteverify-failed', { errorCodes: verdict['error-codes'] || [] });
        return;
      }
      if (url.pathname === '/api/magic-link') {
        json(res, 200, { mint: 'ok', note: 'stub mint; production would enqueue the magic-link email here' });
        return;
      }
      json(res, 200, { received: 'ok' });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  } catch (err) {
    console.error('server error', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errorCode: 'server-error', detail: String(err && err.message ? err.message : err) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log('LISTENING ' + bound);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
