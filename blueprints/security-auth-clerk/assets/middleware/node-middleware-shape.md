# Node middleware boundary shape

The framework-agnostic middleware boundary contract, worked as a shape reference plus two framework-specific adapter samples. The blueprint's TAC-1001 fixes the shape (`verify(request) -> { authenticated, principal?, reason? }`) and the attachment convention (`request.auth`). The framework adapters below are one-file wrappers around the same `verify`; a project on Fastify does not import the Express sample, and vice versa.

## The core `verify` shape

```
// src/auth/middleware.ts (or the project's equivalent module path)
import { createSessionVerifier } from './session-verifier';
import { reduceClaims } from './claims-mapper';

export function createVerify({ clerkClient, auditSink, clock }) {
  const verifier = createSessionVerifier({ clerkClient, auditSink, clock });

  return async function verify(request) {
    const cookieHeader = request.headers.cookie ?? '';
    const sessionCookie = parseCookie(cookieHeader, '__session');
    if (!sessionCookie) {
      return { authenticated: false, reason: 'no-session-cookie' };
    }

    const result = await verifier.verifySessionCookie(sessionCookie);
    if (!result.valid) {
      return { authenticated: false, reason: result.reason ?? 'invalid-session' };
    }

    const principal = reduceClaims(result.claims);
    return { authenticated: true, principal };
  };
}
```

`parseCookie` is a one-liner cookie-header parser the project already has (or writes as a two-line helper); Clerk's SDK exposes its own cookie helpers on some Node adapters, and using those is fine.

## Express adapter

```
// src/auth/adapters/express.ts
import { createVerify } from '../middleware';

export function expressMiddleware(deps) {
  const verify = createVerify(deps);

  return async function (req, res, next) {
    const result = await verify(req);
    if (!result.authenticated) {
      if (req.accepts('html')) {
        return res.redirect(302, '/sign-in');
      }
      return res.status(401).json({ error: 'unauthenticated', reason: result.reason });
    }
    req.auth = result.principal;
    next();
  };
}
```

## Fastify adapter

```
// src/auth/adapters/fastify.ts
import fp from 'fastify-plugin';
import { createVerify } from '../middleware';

export const fastifyPlugin = fp(async (fastify, deps) => {
  const verify = createVerify(deps);

  fastify.addHook('preHandler', async (request, reply) => {
    const result = await verify(request);
    if (!result.authenticated) {
      if (request.headers.accept?.includes('text/html')) {
        return reply.redirect(302, '/sign-in');
      }
      return reply.code(401).send({ error: 'unauthenticated', reason: result.reason });
    }
    request.auth = result.principal;
  });
});
```

## Notes

- Both adapters attach to `request.auth`; downstream handlers read the same field name regardless of framework. This is what the `AC-9101-2` runtime observation binds against.
- Both adapters refuse with 401 for API-shaped requests and a 302 redirect for HTML-shaped ones; the shape choice is a route-class convention the operator adjusts if the project's error envelope differs.
- Neither adapter caches the verification result across requests inside the adapter; the caching (if any) lives inside the session verifier and is bounded by the `revocationCheckIntervalMs` window on ADR-1005.
- Neither adapter reads the raw claim bag; the reduction happens once inside `createVerify` and the adapter attaches the reduced `Principal`.
