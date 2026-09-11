// Token-entropy shape probe. Issues 1,000 tokens against the fixture
// manager and asserts no collisions per AC-3103-1 ("every issue
// produces a distinct handle across a batch of one thousand").
// Asserts tokens are base64url-only and at least 32 chars per
// AC-3103-1 (base64url of at least 24 bytes of entropy). Also
// asserts the token carries no JWT-shaped delimiter per AC-3103-2.
//
// capability: principalDirectory.
// Anchors (per closure): AC-3103-1 (base64url, >= 24 bytes entropy,
//   1000 distinct handles), AC-3103-2 (no JWT-shaped payload).
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = 'security-auth-magic-link-AC-3103-1';
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
    // AC-3103-1: base64url only, length >= 32 chars (>= 24 bytes).
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length < 32) {
      if (shapeBad.length < 3) shapeBad.push({ len: token.length, sample: token.slice(0, 6) });
    }
    // AC-3103-2: no JWT-shaped delimiter (no dots).
    if (token.includes('.')) {
      if (jwtShaped.length < 3) jwtShaped.push({ sample: token.slice(0, 12) });
    }
  }
  const results = [];
  results.push({
    anchorAcId,
    capability,
    verdict: tokens.size === N ? 'pass' : 'fail',
    detail: `AC-3103-1 (distinct handles across a batch of one thousand): unique=${tokens.size} requested=${N}`,
    evidence: { uniqueCount: tokens.size, requested: N },
  });
  results.push({
    anchorAcId,
    capability,
    verdict: shapeBad.length === 0 ? 'pass' : 'fail',
    detail: `AC-3103-1 (base64url, >= 24 bytes entropy => >= 32 chars): shapeViolations=${JSON.stringify(shapeBad)}`,
    evidence: { shapeBadSample: shapeBad, sampledN: N },
  });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3103-2',
    capability,
    verdict: jwtShaped.length === 0 ? 'pass' : 'fail',
    detail: `AC-3103-2 (no JWT-shaped delimiter): jwtShapedTokens=${JSON.stringify(jwtShaped)}`,
    evidence: { jwtShapedSample: jwtShaped, sampledN: N },
  });
  return { results, extra: {} };
}
