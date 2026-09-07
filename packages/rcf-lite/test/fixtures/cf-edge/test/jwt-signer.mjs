// Fixture JWT signer for the cf-edge fixture.
//
// Dependency-free RS256 signer built on Node's built-in crypto.
// Generates a keypair per-process (or takes one supplied by the
// caller for deterministic multi-run scenarios), exposes signJwt()
// producing a JWS compact serialisation, and jwksExport() producing
// the JWKS document (public half only) the validator fetches from
// the fixture endpoint at /.well-known/jwks.json.
//
// The signer is fixture-only and never ships in the applied
// project code path; it lives under test/ so the sole-reader-scan
// probe walking src/**/*.mjs does not consider it.

import { generateKeyPairSync, createSign, createVerify, createPublicKey } from 'node:crypto';

const B64URL = { alphabet: 'base64url' };

export function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

export function base64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

export function createFixtureKey(kid = 'cf-edge-fixture-kid-1') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey, privateKey, kid, algorithm: 'RS256' };
}

// Encode a JWK Set entry (public half only). The Access JWKS shape
// is {keys: [{kid, kty, use, alg, n, e}]}; we mirror it verbatim.
export function jwksExport(...keys) {
  return {
    keys: keys.map((k) => {
      const jwk = k.publicKey.export({ format: 'jwk' });
      return {
        kid: k.kid,
        kty: jwk.kty,
        use: 'sig',
        alg: k.algorithm,
        n: jwk.n,
        e: jwk.e,
      };
    }),
  };
}

export function signJwt(key, claims, { header } = {}) {
  const head = { alg: key.algorithm, typ: 'JWT', kid: key.kid, ...(header ?? {}) };
  const enc = (obj) => base64url(JSON.stringify(obj));
  const signingInput = `${enc(head)}.${enc(claims)}`;
  const sig = createSign('RSA-SHA256').update(signingInput).end().sign(key.privateKey);
  return `${signingInput}.${base64url(sig)}`;
}

export function fixtureIatExpiry(nowSec, ttlSec) {
  return { iat: nowSec, nbf: nowSec, exp: nowSec + ttlSec };
}

// Fresh public-key export used by the validator's JWKS fetcher.
export function publicKeyOnly(key) {
  return createPublicKey({ key: key.publicKey.export({ format: 'pem', type: 'spki' }), format: 'pem' });
}

// Small convenience: build a fixture-JWT for the standard claim
// shape the Access validator reduces (email, sub, groups); adds
// iss and aud from the injected profile.
export function fixtureAccessJwt({ key, profile, principal, ttlSec = 60, nowMs }) {
  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  const claims = {
    iss: profile.issuer,
    aud: profile.audience,
    sub: principal.sub,
    email: principal.email,
    groups: principal.groups ?? [],
    ...fixtureIatExpiry(now, ttlSec),
  };
  return signJwt(key, claims);
}
