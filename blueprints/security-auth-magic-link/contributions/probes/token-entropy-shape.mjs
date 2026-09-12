// Magic-link TOKEN entropy shape probe. Conformance-only. Every row
// records anchorAcId=null with a limitation naming the shipped AC
// whose route-level token property the fixture-manager sample does
// not observe. The integration harness follow-up is the surface
// where the AC-level properties become observable.
//
// capability: principalDirectory. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = null;
export const capability = 'principalDirectory';
export const accountBound = false;

const LIM = 'security-auth-magic-link-AC-3102-1: probe samples fixture-manager tokens for uniqueness and base64url shape at the manager layer; the AC states GET /login/verify consumes each token exactly once, which requires observing the deployed route through the integration harness follow-up.';

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
  results.push(deClaim({
    capability,
    verdict: tokens.size === N ? 'pass' : 'fail',
    detail: `distinct-token sample across ${N} issues: unique=${tokens.size}`,
    evidence: { uniqueCount: tokens.size, requested: N },
  }, { ac: 'security-auth-magic-link-AC-3102-1', limitation: LIM }));
  results.push(deClaim({
    capability,
    verdict: shapeBad.length === 0 ? 'pass' : 'fail',
    detail: `base64url shape sweep at token layer: violations=${JSON.stringify(shapeBad)}`,
    evidence: { shapeBadSample: shapeBad, sampledN: N },
  }, { ac: 'security-auth-magic-link-AC-3102-1', limitation: LIM }));
  results.push(deClaim({
    capability,
    verdict: jwtShaped.length === 0 ? 'pass' : 'fail',
    detail: `JWT-delimiter absence sweep at token layer: violations=${JSON.stringify(jwtShaped)}`,
    evidence: { jwtShapedSample: jwtShaped, sampledN: N },
  }, { ac: 'security-auth-magic-link-AC-3102-1', limitation: LIM }));
  return { results, extra: {} };
}
