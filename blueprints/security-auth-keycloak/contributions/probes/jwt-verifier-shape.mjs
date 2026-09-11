// JWT verifier shape probe for security-auth-keycloak. Signs a
// scratch RS256 token with an in-process throwaway RSA keypair,
// verifies it against the corresponding public key with the
// expected issuer, then mutates each of (alg, exp, iss, signature)
// and asserts the verifier refuses each mutation with a named
// error. TAC-1202 contract.
//
// capability: credentialSelfService (token verify sits at the
//   heart of the self-service session round-trip).
// anchorAcId: security-auth-keycloak-AC-11102-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-AC-11102-1';
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
    detail: `verify happy: ok=${good.ok} sub=${good.payload && good.payload.sub}`,
    evidence: { verifierReturn: { ok: good.ok, sub: good.payload && good.payload.sub } },
  });

  // Signature tamper: flip last char
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].slice(-1) === 'A' ? 'B' : 'A'}`;
  const badSig = verifyRs256({ token: tampered, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11102-2',
    capability,
    verdict: !badSig.ok && /signature/.test(badSig.error) ? 'pass' : 'fail',
    detail: `verify signature-tamper refusal: ok=${badSig.ok} error=${JSON.stringify(badSig.error)}`,
    evidence: { verifierReturn: badSig },
  });

  // Expired token
  const expiredToken = signRs256({ header: { alg: 'RS256', typ: 'JWT' }, payload: { sub: 'x', iss, exp: now - 60 }, privateKey });
  const badExp = verifyRs256({ token: expiredToken, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11102-3',
    capability,
    verdict: !badExp.ok && /expired/.test(badExp.error) ? 'pass' : 'fail',
    detail: `verify expired refusal: ok=${badExp.ok} error=${JSON.stringify(badExp.error)}`,
    evidence: { verifierReturn: badExp },
  });

  // Wrong iss
  const wrongIss = verifyRs256({ token, publicKey, expectedIssuer: 'https://kc.example.com/realms/other' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11102-4',
    capability,
    verdict: !wrongIss.ok && /iss mismatch/.test(wrongIss.error) ? 'pass' : 'fail',
    detail: `verify iss-mismatch refusal: ok=${wrongIss.ok} error=${JSON.stringify(wrongIss.error)}`,
    evidence: { verifierReturn: wrongIss },
  });

  // alg=none via crafted header
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ sub: 'x', iss, exp: now + 300 })).toString('base64url');
  const noneToken = `${noneHeader}.${nonePayload}.`;
  const badAlg = verifyRs256({ token: noneToken, publicKey, expectedIssuer: iss });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11102-5',
    capability,
    verdict: !badAlg.ok && /alg must be RS256/.test(badAlg.error) ? 'pass' : 'fail',
    detail: `verify alg=none refusal: ok=${badAlg.ok} error=${JSON.stringify(badAlg.error)}`,
    evidence: { verifierReturn: badAlg },
  });

  return { results, extra: {} };
}
