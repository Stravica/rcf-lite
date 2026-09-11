// Magic-link TOKEN entropy shape probe. Issues 1,000 magic-link
// tokens against the fixture manager and asserts no collisions,
// base64url shape and length band, and no JWT-shaped delimiter.
//
// Anchor honesty. AC-3103-1 and AC-3103-2 (story-3103) bind SESSION
// HANDLE entropy and shape, not magic-link-token entropy. The
// fixture is a magic-link TOKEN manager (TAC-501), not a session
// manager (TAC-502); the two live at different layers of the sign-
// in flow. Anchoring AC-3103-* here would mis-state what the probe
// observes. This probe therefore anchors REQ-002 (issue produces a
// single-use TTL-bounded, high-entropy magic-link token) with the
// "no AC covers this property at the token layer" fact stated in
// `detail`, per closure addendum rule 1. On the shelf review this
// row reads AMBER for the AC-3103-* properties; a probe that
// samples session handles from a session manager is the follow-up
// that would turn AC-3103-* rows green.
//
// capability: principalDirectory.
// engine: fixture.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = 'security-auth-magic-link-REQ-002';
export const capability = 'principalDirectory';
export const accountBound = false;

export default async function runProbe() {
  const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);
  const mgr = createMagicLinkManager({ ttlSeconds: 900 });
  const tokens = new Set();
  const N = 1_000;
  const shapeBad = [];
  const jwtShaped = [];
  for (let i = 0; i < N; i++) {
    const { token } = await mgr.issue({ emailAddress: `u${i}@example.com` });
    tokens.add(token);
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length < 32) {
      if (shapeBad.length < 3) shapeBad.push({ len: token.length, sample: token.slice(0, 6) });
    }
    if (token.includes('.')) {
      if (jwtShaped.length < 3) jwtShaped.push({ sample: token.slice(0, 12) });
    }
  }
  const results = [];
  results.push({
    anchorAcId,
    capability,
    verdict: tokens.size === N ? 'pass' : 'fail',
    detail: `REQ-002 (no AC states the magic-link-token entropy property at the TOKEN manager layer; AC-3103-1 binds SESSION HANDLES, not magic-link tokens; anchoring REQ per closure rule 1): distinct tokens across ${N} issues; observed unique=${tokens.size}. Fixture-layer observation.`,
    evidence: { uniqueCount: tokens.size, requested: N, notObservableACs: ['security-auth-magic-link-AC-3103-1', 'security-auth-magic-link-AC-3103-2'], notObservableReason: 'AC-3103-* target session handles from a session manager (TAC-502); this fixture is a magic-link TOKEN manager (TAC-501).' },
  });
  results.push({
    anchorAcId,
    capability,
    verdict: shapeBad.length === 0 ? 'pass' : 'fail',
    detail: `REQ-002 (magic-link tokens are base64url of >=24 bytes of entropy at the TOKEN layer; AC-3103-1 binds session-handle shape, not magic-link-token shape): shapeViolations=${JSON.stringify(shapeBad)}. Fixture-layer observation.`,
    evidence: { shapeBadSample: shapeBad, sampledN: N },
  });
  results.push({
    anchorAcId,
    capability,
    verdict: jwtShaped.length === 0 ? 'pass' : 'fail',
    detail: `REQ-002 (magic-link tokens carry no JWT-shaped delimiter at the TOKEN layer; AC-3103-2 binds session-handle shape): jwtShapedTokens=${JSON.stringify(jwtShaped)}. Fixture-layer observation.`,
    evidence: { jwtShapedSample: jwtShaped, sampledN: N },
  });
  return { results, extra: {} };
}
