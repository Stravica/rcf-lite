// PKCE challenge-and-verify shape probe. Conformance-only per
// _closure3.md: helper derivation is not the project sign-in
// route, verifier-mismatch collision is not invalid_grant with
// flow termination, and REQ-002 describes provider-record fields
// rather than a verifier length band. Rows keep their local
// derivation observations; integration harness
// (w-2026-09-11-dave-015) is the surface where AC-level
// properties become observable.
//
// capability: authorisationCodeFlow. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = null;
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

const LIM_HAPPY = 'security-auth-oauth2-AC-10101-1: probe checks S256 derivation only; the AC states the project sign-in route redirects to the provider /authorize with a valid code_challenge, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_MISMATCH = 'security-auth-oauth2-AC-10103-2: probe observes verifier-hash divergence only; the AC states invalid_grant at /token, flow termination, and absence of session issue, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_LEN = 'security-auth-oauth2-REQ-002: REQ-002 describes provider-record fields, not a PKCE verifier length band; the length band belongs to RFC 7636 not this REQ.';

export default async function runProbe() {
  const { generatePkcePair } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'mock-authorization-server.mjs')).href);
  const results = [];

  const pair = generatePkcePair();
  const derived = createHash('sha256').update(pair.verifier).digest('base64url');
  const nonEmptyChallenge = typeof pair.challenge === 'string' && pair.challenge.length > 0;
  results.push(deClaim({
    capability,
    verdict: derived === pair.challenge && pair.method === 'S256' && nonEmptyChallenge ? 'pass' : 'fail',
    detail: `code_challenge_method=${pair.method} code_challenge non-empty=${nonEmptyChallenge} derived==challenge=${derived === pair.challenge}`,
    evidence: { verifierLength: pair.verifier.length, challengePreviewFirst8: pair.challenge.slice(0, 8), method: pair.method, derivationMatched: derived === pair.challenge },
  }, { ac: 'security-auth-oauth2-AC-10101-1', limitation: LIM_HAPPY }));

  const mutatedVerifier = pair.verifier + 'X';
  const mutatedDerived = createHash('sha256').update(mutatedVerifier).digest('base64url');
  results.push(deClaim({
    capability,
    verdict: mutatedDerived !== pair.challenge ? 'pass' : 'fail',
    detail: `verifier-mutation derivation diverges from original: collided=${mutatedDerived === pair.challenge}`,
    evidence: { mutation: 'verifier+X', collidedWithOriginal: mutatedDerived === pair.challenge },
  }, { ac: 'security-auth-oauth2-AC-10103-2', limitation: LIM_MISMATCH }));

  const okLen = pair.verifier.length >= 43 && pair.verifier.length <= 128;
  results.push(deClaim({
    capability,
    verdict: okLen ? 'pass' : 'fail',
    detail: `RFC 7636 sec 4.1 verifier length in [43,128]: observed=${pair.verifier.length}.`,
    evidence: { verifierLength: pair.verifier.length, min: 43, max: 128 },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.1', verifiedOn: '2026-09-11' },
  }, { ac: 'security-auth-oauth2-REQ-002', limitation: LIM_LEN }));

  return { results, extra: {} };
}
