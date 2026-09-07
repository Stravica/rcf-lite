// Access JWT validator middleware for the cf-edge fixture.
//
// This module is the SOLE reader of the Cf-Access-Jwt-Assertion
// header in the applied source tree (per edge-cloudflare-access
// REQ-080 sole-reader guarantee). Every other module reaches the
// reduced principal via request.auth only.
//
// The validator fetches the Access JWKS from the elicited env var
// ACCESS_JWKS_URL, caches keys per-kid for the elicited cache
// window, verifies the JWT against the cached key matching the
// header's kid, and reduces the principal into request.auth as
// {email, sub, groups}. On any validate-failure it emits an audit
// event on the injected sink with metadata-only fields (email,
// outcome, timestamp, path) and returns 401. The token value and
// header names beyond path never enter the audit record.
//
// Break-glass posture: when the elicited bypass-service-auth pair
// is applied and the request presents both CF-Access-Client-Id and
// CF-Access-Client-Secret headers, the validator observes the pair,
// records outcome=bypass and delegates to the handler as authenticated
// with request.auth.email='service:'+id.

import { createVerify, createPublicKey } from 'node:crypto';

const HEADER = 'Cf-Access-Jwt-Assertion';
const BYPASS_ID_HEADER = 'CF-Access-Client-Id';
const BYPASS_SECRET_HEADER = 'CF-Access-Client-Secret';

const SIMULATED_MISSING = 'SIMULATE_MISSING_JWT';
const SIMULATED_EXPIRED = 'SIMULATE_EXPIRED_JWT';
const SIMULATED_BYPASS = 'SIMULATE_BYPASS_SERVICE_AUTH';

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

function timestamp(clock) {
  return typeof clock === 'function' ? clock() : new Date().toISOString();
}

function auditRecord({ email, outcome, timestamp, path }) {
  // Explicit shape: only these four keys are legal in an audit
  // record. The record is frozen so a downstream handler cannot
  // enrich it with a stray token slice.
  return Object.freeze({ email, outcome, timestamp, path });
}

async function fetchJwks(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`jwks fetch failed: HTTP ${res.status}`);
  return res.json();
}

function keyFromJwk(jwk) {
  return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
}

function verifySignature(alg, publicKey, signingInput, signature) {
  if (alg !== 'RS256') return false;
  return createVerify('RSA-SHA256').update(signingInput).end().verify(publicKey, signature);
}

export function createAccessValidator({ env, eventSink, fetch: fetchImpl = fetch, clock, bypassServiceAuth }) {
  const jwksUrl = env.ACCESS_JWKS_URL;
  const audience = env.ACCESS_AUDIENCE;
  const cache = new Map(); // kid -> {key, fetchedAt}
  const cacheTtlMs = 60 * 1000;
  const bypass = bypassServiceAuth || null;

  async function jwksKeyForKid(kid) {
    const now = Date.now();
    const cached = cache.get(kid);
    if (cached && now - cached.fetchedAt < cacheTtlMs) return cached.key;
    const jwks = await fetchJwks(jwksUrl, fetchImpl);
    for (const jwk of jwks.keys ?? []) {
      cache.set(jwk.kid, { key: keyFromJwk(jwk), fetchedAt: now });
    }
    return cache.get(kid)?.key ?? null;
  }

  function readHeader(request) {
    // The one live-source read of Cf-Access-Jwt-Assertion in the
    // fixture applied source tree. Every other module reaches
    // request.auth instead.
    return request.headers.get(HEADER);
  }

  async function validate(request, { path, envSwitches = {} } = {}) {
    const resolvedPath = path ?? new URL(request.url).pathname;
    const now = timestamp(clock);

    // Break-glass path: paired headers.
    if (bypass && (envSwitches[SIMULATED_BYPASS] || (request.headers.get(BYPASS_ID_HEADER) && request.headers.get(BYPASS_SECRET_HEADER)))) {
      const id = request.headers.get(BYPASS_ID_HEADER) || bypass.id;
      const secret = request.headers.get(BYPASS_SECRET_HEADER) || bypass.secret;
      if (id === bypass.id && secret === bypass.secret) {
        const principal = { email: `service:${bypass.id}`, sub: `service:${bypass.id}`, groups: [] };
        const record = auditRecord({ email: principal.email, outcome: 'bypass', timestamp: now, path: resolvedPath });
        eventSink(record);
        return { ok: true, principal };
      }
    }

    let raw = readHeader(request);
    if (envSwitches[SIMULATED_MISSING]) raw = null;

    if (!raw) {
      const record = auditRecord({ email: null, outcome: 'missing', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'missing' };
    }

    const parts = raw.split('.');
    if (parts.length !== 3) {
      const record = auditRecord({ email: null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }
    let header, payload;
    try {
      header = decodeSegment(parts[0]);
      payload = decodeSegment(parts[1]);
    } catch {
      const record = auditRecord({ email: null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }

    if (audience && payload.aud !== audience) {
      const record = auditRecord({ email: payload.email ?? null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const effectiveExp = envSwitches[SIMULATED_EXPIRED] ? nowSec - 60 : payload.exp;
    if (typeof effectiveExp !== 'number' || effectiveExp < nowSec) {
      const record = auditRecord({ email: payload.email ?? null, outcome: 'expired', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'expired' };
    }

    let key;
    try {
      key = await jwksKeyForKid(header.kid);
    } catch {
      const record = auditRecord({ email: payload.email ?? null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }
    if (!key) {
      const record = auditRecord({ email: payload.email ?? null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }

    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');
    const ok = verifySignature(header.alg, key, signingInput, signature);
    if (!ok) {
      const record = auditRecord({ email: payload.email ?? null, outcome: 'invalid', timestamp: now, path: resolvedPath });
      eventSink(record);
      return { ok: false, status: 401, reason: 'invalid' };
    }

    const principal = {
      email: payload.email ?? null,
      sub: payload.sub ?? null,
      groups: Array.isArray(payload.groups) ? payload.groups.slice() : [],
    };
    const record = auditRecord({ email: principal.email, outcome: 'validated', timestamp: now, path: resolvedPath });
    eventSink(record);
    return { ok: true, principal };
  }

  async function middleware(request, envSwitches) {
    const outcome = await validate(request, { envSwitches });
    if (!outcome.ok) {
      return { rejected: true, response: new Response('access denied\n', { status: outcome.status, headers: { 'content-type': 'text/plain; charset=utf-8' } }), outcome };
    }
    // Attach principal to the request-like object so the downstream
    // handler observes request.auth without ever touching the header.
    Object.defineProperty(request, 'auth', {
      value: outcome.principal,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    return { rejected: false, outcome };
  }

  return { validate, middleware };
}
