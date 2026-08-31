# Workers fetch-handler shape

The Cloudflare Workers adapter for the middleware boundary (TAC-1001). Chooser: a project on Node picks up `node-middleware-shape.md` (Express or Fastify adapter around `verify(request)`); a project on Workers picks up this file. Both adapters wrap the same `verify` contract; the reduced `Principal` shape the project reasons against downstream is identical.

## Why Workers gets its own sample

The framework-agnostic `verify(request)` contract (TAC-1001 responsibility 1) already carries onto Workers. What differs is mechanical:

- **Request object.** The handler receives a Fetch API `Request`; header reads go through `request.headers.get('cookie')`, not `request.headers.cookie`. There is no `req.accepts()`; content-negotiation is a header inspection on `accept`.
- **Response shape.** Handlers return a Fetch API `Response` synchronously; there is no `res.status().json()` chain. The refusal paths return `new Response(...)` bodies.
- **Secret transport.** The Clerk secret arrives on `env.CLERK_SECRET_KEY` (and `env.CLERK_PUBLISHABLE_KEY`) at request time, not from `process.env` at module load. The `createVerify` factory therefore runs inside the fetch handler, not at module top-level; a per-request construction is cheap because Clerk's `authenticateRequest` is the network cost, not the client construction.
- **Session-cookie parse.** Clerk's `@clerk/backend` `authenticateRequest(request, ...)` reads the `__session` cookie off the Fetch `Request` itself; no manual cookie header parsing is needed at the middleware seam. The pre-check below (a substring test for `__session=`) is a fast-path refusal so unauthenticated hits do not incur an SDK round trip.

## The Workers fetch adapter

```
// src/auth/adapters/workers.mjs
import { createSessionVerifier } from '../session-verifier.mjs';
import { reduceClaims } from '../claims-mapper.mjs';

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export function createVerify({ clerkSecretKey, clerkPublishableKey, auditSink, clock }) {
  const verifier = createSessionVerifier({
    clerkSecretKey,
    clerkPublishableKey,
    auditSink,
    clock
  });

  return async function verify(request) {
    // Fast-path refusal without an SDK round trip.
    const cookieHeader = request.headers.get('cookie') ?? '';
    if (!/(?:^|;\s*)__session=/.test(cookieHeader)) {
      return { authenticated: false, reason: 'no-session-cookie' };
    }
    // Clerk's authenticateRequest reads the __session cookie off the Request
    // and does the vendor-verified session verification server-side.
    const result = await verifier.verifySessionCookie(null, request);
    if (!result.valid) {
      return { authenticated: false, reason: result.reason ?? 'invalid-session' };
    }
    let principal;
    try {
      principal = reduceClaims(result.claims);
    } catch (err) {
      return { authenticated: false, reason: 'claims-map-failed' };
    }
    return { authenticated: true, principal };
  };
}

// One-file adapter that a route dispatcher inside `fetch()` can call.
// The blueprint does not mandate any particular router; the shape below is
// the seam a project's router calls into. Route dispatch stays a project
// concern.
export function workersRequireAuth({ verify }) {
  return async function requireAuth(request) {
    const result = await verify(request);
    if (result.authenticated) {
      return { ok: true, principal: result.principal };
    }
    const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
    const refusal = wantsHtml
      ? Response.redirect(new URL('/sign-in', request.url).toString(), 302)
      : jsonResponse({ error: 'unauthenticated', reason: result.reason }, 401);
    return { ok: false, refusal };
  };
}
```

## Wiring it inside a fetch handler

```
// src/worker.mjs
import { createVerify, workersRequireAuth } from './auth/adapters/workers.mjs';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Public probes and the sign-in redirect run before the auth gate.
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(null, { status: 200 });
    }
    if (url.pathname === '/sign-in') {
      return Response.redirect(env.CLERK_SIGN_IN_URL, 302);
    }

    // Auth-gated routes go through the middleware boundary.
    const verify = createVerify({
      clerkSecretKey: env.CLERK_SECRET_KEY,
      clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY,
      auditSink: (evt) => console.log(JSON.stringify({ ...evt, kind: 'audit' })),
      clock: () => new Date()
    });
    const requireAuth = workersRequireAuth({ verify });

    if (url.pathname.startsWith('/api/')) {
      const authResult = await requireAuth(request);
      if (!authResult.ok) return authResult.refusal;
      // request.auth is a Fetch API surface convention the project owns:
      // attach the principal onto a locals object the route handler reads.
      return dispatchApi(url, request, env, ctx, authResult.principal);
    }

    return env.ASSETS.fetch(request);
  }
};
```

## Notes

- **Attachment convention.** The Fetch `Request` is immutable, so the middleware cannot literally set `request.auth`. The Workers adapter's shape returns `{ ok, principal, refusal }` and the route handler carries the `principal` forward as a function argument. AC-9101-2's runtime observation binds against the reduced `Principal` shape on the successful path either way; the mechanism of attachment is framework-shaped, not contract-shaped.
- **SDK boundary discipline.** Only `session-verifier.mjs` and this adapter's `createVerify` factory import from `@clerk/backend`. AC-9102-2's source-tree scan still holds on Workers; the two-module allowance covers the Workers case unchanged.
- **Refusal shape.** The 401 JSON body for API-shaped routes and the 302 redirect for HTML-shaped routes match the Node adapters. AC-9103-2 and AC-9103-3 read the same shapes.
- **Static-asset ordering.** The wrangler `[assets]` binding serves files before the fetch handler runs by default, which silently bypasses this middleware on any URL that also resolves to a static file. The `run_worker_first` posture on any auth-gated route is a wrangler-configuration concern; the workers wrangler.toml sample carries the fix.
- **Runtime.** The verifier calls into `@clerk/backend` which needs Node built-ins; wrangler's `compatibility_flags = ["nodejs_compat"]` is the enabling flag on the wrangler side. This is a runtime-config concern, not a middleware-shape concern.
