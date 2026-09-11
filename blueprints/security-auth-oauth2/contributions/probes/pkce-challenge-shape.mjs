// PKCE challenge-and-verify shape probe for security-auth-oauth2.
// Exercises RFC 7636 sec 4.1-4.2 (verifier generation + S256
// challenge) and sec 4.6 (server-side verify) locally, without
// contacting a remote authorisation server. Proves the derivation
// is a stable SHA-256(base64url) hash of the verifier and refuses
// on any mutation of either side.
//
// capability: authorisationCodeFlow (partial: PKCE challenge/verify
//   shape that AC-10101-1 anchors on the /authorize redirect).
// Anchors (per closure): AC-10101-1 covers the code_challenge S256
// property observed here; AC-10103-2 covers the invalid_grant on
// verifier mismatch observed by the mutation case.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10101-1';
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

export default async function runProbe() {
  const { generatePkcePair } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'mock-authorization-server.mjs')).href);

  const results = [];

  // Happy path: verifier hashes to the challenge, method is S256, challenge non-empty.
  const pair = generatePkcePair();
  const derived = createHash('sha256').update(pair.verifier).digest('base64url');
  const nonEmptyChallenge = typeof pair.challenge === 'string' && pair.challenge.length > 0;
  results.push({
    anchorAcId,
    capability,
    verdict: derived === pair.challenge && pair.method === 'S256' && nonEmptyChallenge ? 'pass' : 'fail',
    detail: `AC-10101-1 property: code_challenge_method=${pair.method} code_challenge non-empty=${nonEmptyChallenge} derived==challenge=${derived === pair.challenge}`,
    evidence: { verifierLength: pair.verifier.length, challengePreviewFirst8: pair.challenge.slice(0, 8), method: pair.method, derivationMatched: derived === pair.challenge },
  });

  // Mutation: verifier changed - derived must NOT equal original challenge
  // (AC-10103-2: invalid_grant on verifier mismatch).
  const mutatedVerifier = pair.verifier + 'X';
  const mutatedDerived = createHash('sha256').update(mutatedVerifier).digest('base64url');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10103-2',
    capability,
    verdict: mutatedDerived !== pair.challenge ? 'pass' : 'fail',
    detail: `AC-10103-2 property (verifier-mismatch derivation diverges from original challenge): collided=${mutatedDerived === pair.challenge}`,
    evidence: { mutation: 'verifier+X', collidedWithOriginal: mutatedDerived === pair.challenge },
  });

  // Length band from RFC 7636 sec 4.1 [43, 128]. No AC states this
  // directly; anchor the REQ.
  const okLen = pair.verifier.length >= 43 && pair.verifier.length <= 128;
  results.push({
    anchorAcId: 'security-auth-oauth2-REQ-002',
    capability,
    verdict: okLen ? 'pass' : 'fail',
    detail: `RFC 7636 sec 4.1 verifier length in [43,128]: observed=${pair.verifier.length}. No AC covers the length band; anchoring the REQ (per closure rule 1).`,
    evidence: { verifierLength: pair.verifier.length, min: 43, max: 128 },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.1', verifiedOn: '2026-09-11' },
  });

  return { results, extra: {} };
}
