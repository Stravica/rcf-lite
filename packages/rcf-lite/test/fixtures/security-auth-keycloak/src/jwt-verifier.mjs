// TAC-1202 Keycloak JWT verifier shape. Uses Node's built-in
// crypto to verify a Keycloak-issued RS256 access token against a
// public key. The verifier refuses:
// - a token whose header alg is not RS256 (Keycloak realm default);
// - a token whose exp is in the past;
// - a token whose iss does not match the expected issuer;
// - a token whose signature does not verify against the key.
//
// Fixture uses an in-process throwaway RSA key so the shape can be
// exercised locally without a Keycloak jwks_uri fetch. The real
// verifier composes a jwks fetch on top of the same primitive.

import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64url');
const b64urlJson = (o) => b64url(JSON.stringify(o));

export function generateThrowawayKeypair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

export function signRs256({ header, payload, privateKey }) {
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  const sig = signer.sign(privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyRs256({ token, publicKey, expectedIssuer }) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'token does not have three segments' };
  const [h, p, s] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'header or payload is not JSON' };
  }
  if (header.alg !== 'RS256') return { ok: false, error: `alg must be RS256; observed ${header.alg}` };
  const verify = createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  verify.end();
  const sigOk = verify.verify(publicKey, Buffer.from(s, 'base64url'));
  if (!sigOk) return { ok: false, error: 'signature did not verify against key' };
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return { ok: false, error: `token expired: exp=${payload.exp} now=${now}` };
  if (expectedIssuer && payload.iss !== expectedIssuer) return { ok: false, error: `iss mismatch: expected=${expectedIssuer} got=${payload.iss}` };
  return { ok: true, header, payload };
}
