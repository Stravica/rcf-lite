// JWT verifier shape probe for security-auth-keycloak.
// Conformance-only per _closure3.md: local RS256 sign+verify on
// throwaway keys does not observe the JWKS cache/kid behaviour,
// the audit event or a verified-token session; rows keep their
// verifier observations. Integration harness (the auth integration harness follow-up)
// is the surface where the AC-level properties become observable.
//
// capability: credentialSelfService. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = null;
export const capability = 'credentialSelfService';
export const accountBound = false;

const LIM_KID = 'security-auth-keycloak-AC-11103-1: probe verifies against an in-process public key; the AC requires JWKS-cache resolution by kid, needs the integration harness (the auth integration harness follow-up).';
const LIM_SIG = 'security-auth-keycloak-AC-11104-2: probe verifies against a static public key; the AC requires refresh-then-refuse when the kid is unpublished, needs the integration harness (the auth integration harness follow-up).';
const LIM_EXP = 'security-auth-keycloak-AC-11104-1: probe checks expiry-refusal on a synthetic token; the AC requires session absence + 4xx + audit event at the request handler, needs the integration harness (the auth integration harness follow-up).';
const LIM_ISS = 'security-auth-keycloak-AC-11117-7: probe observes iss mismatch refusal; the AC states an audit event with reasonClass=issuer_mismatch is emitted at the handler, needs the integration harness (the auth integration harness follow-up).';
const LIM_ALG = 'security-auth-keycloak-REQ-003: probe observes alg=none refusal at the verifier; REQ-003 covers the verifier interface contract at the TAC-1202 boundary, which the integration harness (the auth integration harness follow-up) exercises.';

export default async function runProbe() {
  const { generateThrowawayKeypair, signRs256, verifyRs256 } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'jwt-verifier.mjs')).href);
  const { privateKey, publicKey } = generateThrowawayKeypair();
  const results = [];
  const iss = 'https://kc.example.com/realms/example-realm';
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'user-abc', iss, exp: now + 300, iat: now };
  const token = signRs256({ header: { alg: 'RS256', typ: 'JWT' }, payload, privateKey });

  const good = verifyRs256({ token, publicKey, expectedIssuer: iss });
  results.push(deClaim({
    capability,
    verdict: good.ok && good.payload && good.payload.sub === 'user-abc' ? 'pass' : 'fail',
    detail: `well-formed RS256 verify against public key: ok=${good.ok} sub=${good.payload && good.payload.sub}`,
    evidence: { verifierReturn: { ok: good.ok, sub: good.payload && good.payload.sub } },
  }, { ac: 'security-auth-keycloak-AC-11103-1', limitation: LIM_KID }));

  const parts = token.split('.');
  const firstSigChar = parts[2].slice(0, 1);
  const flipped = firstSigChar === 'A' ? 'B' : 'A';
  const tampered = `${parts[0]}.${parts[1]}.${flipped}${parts[2].slice(1)}`;
  const badSig = verifyRs256({ token: tampered, publicKey, expectedIssuer: iss });
  results.push(deClaim({
    capability,
    verdict: !badSig.ok && /signature/.test(badSig.error) ? 'pass' : 'fail',
    detail: `tampered-signature refused: ok=${badSig.ok} error=${JSON.stringify(badSig.error)}`,
    evidence: { verifierReturn: badSig },
  }, { ac: 'security-auth-keycloak-AC-11104-2', limitation: LIM_SIG }));

  const expiredToken = signRs256({ header: { alg: 'RS256', typ: 'JWT' }, payload: { sub: 'x', iss, exp: now - 60 }, privateKey });
  const badExp = verifyRs256({ token: expiredToken, publicKey, expectedIssuer: iss });
  results.push(deClaim({
    capability,
    verdict: !badExp.ok && /expired/.test(badExp.error) ? 'pass' : 'fail',
    detail: `past-exp refused: ok=${badExp.ok} error=${JSON.stringify(badExp.error)}`,
    evidence: { verifierReturn: badExp },
  }, { ac: 'security-auth-keycloak-AC-11104-1', limitation: LIM_EXP }));

  const wrongIss = verifyRs256({ token, publicKey, expectedIssuer: 'https://kc.example.com/realms/other' });
  results.push(deClaim({
    capability,
    verdict: !wrongIss.ok && /iss mismatch/.test(wrongIss.error) ? 'pass' : 'fail',
    detail: `iss-mismatch refused: ok=${wrongIss.ok} error=${JSON.stringify(wrongIss.error)}`,
    evidence: { verifierReturn: wrongIss },
  }, { ac: 'security-auth-keycloak-AC-11117-7', limitation: LIM_ISS }));

  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ sub: 'x', iss, exp: now + 300 })).toString('base64url');
  const noneToken = `${noneHeader}.${nonePayload}.`;
  const badAlg = verifyRs256({ token: noneToken, publicKey, expectedIssuer: iss });
  results.push(deClaim({
    capability,
    verdict: !badAlg.ok && /alg must be RS256/.test(badAlg.error) ? 'pass' : 'fail',
    detail: `alg=none refused: ok=${badAlg.ok} error=${JSON.stringify(badAlg.error)}`,
    evidence: { verifierReturn: badAlg },
  }, { ac: 'security-auth-keycloak-REQ-003', limitation: LIM_ALG }));

  return { results, extra: {} };
}
