// JWT verifier shape probe for security-auth-keycloak. Signs a
// scratch RS256 token with an in-process throwaway RSA keypair,
// verifies it against the corresponding public key with the
// expected issuer, then mutates each of (alg, exp, iss, signature)
// and asserts the verifier refuses each mutation with a named
// error. TAC-1202 contract.
//
// capability: credentialSelfService (token verify sits at the
//   heart of the self-service session round-trip).
// Anchors (per closure): AC-11103-1 (kid present in cached JWKS
// passes verification), AC-11104-1 (exp in past refused with
// KEYCLOAK_JWT_EXPIRED), AC-11104-2 (signature invalid refused with
// KEYCLOAK_JWT_SIGNATURE_INVALID). AC-11117-7 covers the wrong-iss
// audit outcome the wrong-iss row proves; AC-11102-3 sensu lato
// for the alg mandate.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-AC-11103-1';
export const capability = 'credentialSelfService';
export const accountBound = false;

export default async function runProbe() {
  const { generateThrowawayKeypair, signRs256, verifyRs256 } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'jwt-verifier.mjs')).href);
  const { privateKey, publicKey } = generateThrowawayKeypair();
  const results = [];

  const iss = 'https://kc.example.com/realms/stravica-dev';
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'user-abc', iss, exp: now + 300, iat: now };
  const token = signRs256({ header: { alg: 'RS256', typ: 'JWT' }, payload, privateKey });

  const good = verifyRs256({ token, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId,
    capability,
    verdict: good.ok && good.payload && good.payload.sub === 'user-abc' ? 'pass' : 'fail',
    detail: `AC-11103-1 (well-formed RS256 verify against public key): ok=${good.ok} sub=${good.payload && good.payload.sub}`,
    evidence: { verifierReturn: { ok: good.ok, sub: good.payload && good.payload.sub } },
  });

  // Signature tamper: flip first char of the signature segment.
  // (The LAST base64url char of a 256-byte signature encodes only 2
  // significant bits — the other 4 are padding — so mutations there
  // can decode to identical bytes; mutating the first char changes
  // real signature bytes.)
  const parts = token.split('.');
  const firstSigChar = parts[2].slice(0, 1);
  const flipped = firstSigChar === 'A' ? 'B' : 'A';
  const tampered = `${parts[0]}.${parts[1]}.${flipped}${parts[2].slice(1)}`;
  const badSig = verifyRs256({ token: tampered, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11104-2',
    capability,
    verdict: !badSig.ok && /signature/.test(badSig.error) ? 'pass' : 'fail',
    detail: `AC-11104-2 (KEYCLOAK_JWT_SIGNATURE_INVALID on tampered signature): ok=${badSig.ok} error=${JSON.stringify(badSig.error)}`,
    evidence: { verifierReturn: badSig },
  });

  // Expired token
  const expiredToken = signRs256({ header: { alg: 'RS256', typ: 'JWT' }, payload: { sub: 'x', iss, exp: now - 60 }, privateKey });
  const badExp = verifyRs256({ token: expiredToken, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11104-1',
    capability,
    verdict: !badExp.ok && /expired/.test(badExp.error) ? 'pass' : 'fail',
    detail: `AC-11104-1 (KEYCLOAK_JWT_EXPIRED on past exp): ok=${badExp.ok} error=${JSON.stringify(badExp.error)}`,
    evidence: { verifierReturn: badExp },
  });

  // Wrong iss
  const wrongIss = verifyRs256({ token, publicKey, expectedIssuer: 'https://kc.example.com/realms/other' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11117-7',
    capability,
    verdict: !wrongIss.ok && /iss mismatch/.test(wrongIss.error) ? 'pass' : 'fail',
    detail: `AC-11117-7 (iss mismatch refused; audit-event AC anchors the property): ok=${wrongIss.ok} error=${JSON.stringify(wrongIss.error)}`,
    evidence: { verifierReturn: wrongIss },
  });

  // alg=none via crafted header
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ sub: 'x', iss, exp: now + 300 })).toString('base64url');
  const noneToken = `${noneHeader}.${nonePayload}.`;
  const badAlg = verifyRs256({ token: noneToken, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-REQ-003',
    capability,
    verdict: !badAlg.ok && /alg must be RS256/.test(badAlg.error) ? 'pass' : 'fail',
    detail: `REQ-003 (alg=none refused; no AC states the alg mandate literally; anchoring REQ): ok=${badAlg.ok} error=${JSON.stringify(badAlg.error)}`,
    evidence: { verifierReturn: badAlg },
  });

  return { results, extra: {} };
}
