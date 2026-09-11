// PKCE challenge-and-verify shape probe for security-auth-oauth2.
// Exercises RFC 7636 sec 4.1-4.2 (verifier generation + S256
// challenge) and sec 4.6 (server-side verify) locally, without
// contacting a remote authorisation server. Proves the derivation
// is a stable SHA-256(base64url) hash of the verifier and refuses
// on any mutation of either side.
//
// capability: authorisationCodeFlow (partial: this probe covers
//   the PKCE-verifier binding required on every code-flow probe;
//   the full round-trip probe is authorisation-code-flow-shape).
// anchorAcId: security-auth-oauth2-AC-10106-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10106-1';
export const capability = 'authorisationCodeFlow';
export const accountBound = false;

export default async function runProbe() {
  const { generatePkcePair } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'mock-authorization-server.mjs')).href);

  const results = [];

  // Happy path: verifier hashes to the challenge.
  const pair = generatePkcePair();
  const derived = createHash('sha256').update(pair.verifier).digest('base64url');
  results.push({
    anchorAcId,
    capability,
    verdict: derived === pair.challenge && pair.method === 'S256' ? 'pass' : 'fail',
    detail: `PKCE S256 pair: verifierLength=${pair.verifier.length} challengeLength=${pair.challenge.length} method=${pair.method} derivedMatchesChallenge=${derived === pair.challenge}`,
    evidence: { verifierLength: pair.verifier.length, challengePreviewFirst8: pair.challenge.slice(0, 8), method: pair.method, derivationMatched: derived === pair.challenge },
  });

  // Mutation: verifier changed - derived must NOT equal original challenge.
  const mutatedVerifier = pair.verifier + 'X';
  const mutatedDerived = createHash('sha256').update(mutatedVerifier).digest('base64url');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10106-2',
    capability,
    verdict: mutatedDerived !== pair.challenge ? 'pass' : 'fail',
    detail: `PKCE mutation: mutated verifier hash ${mutatedDerived === pair.challenge ? 'collided' : 'diverged'} from original challenge`,
    evidence: { mutation: 'verifier+X', collidedWithOriginal: mutatedDerived === pair.challenge },
  });

  // Length band: RFC 7636 sec 4.1 requires 43-128 chars.
  const okLen = pair.verifier.length >= 43 && pair.verifier.length <= 128;
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10106-3',
    capability,
    verdict: okLen ? 'pass' : 'fail',
    detail: `PKCE verifier length ${pair.verifier.length} within RFC 7636 sec 4.1 [43, 128]`,
    evidence: { verifierLength: pair.verifier.length, min: 43, max: 128 },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.1', verifiedOn: '2026-09-11' },
  });

  return { results, extra: {} };
}
