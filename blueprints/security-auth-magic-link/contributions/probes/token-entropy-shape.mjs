// Magic-link TOKEN entropy shape probe. Conformance-only per
// _closure3.md: REQ-002 does not state high entropy, base64url
// form, JWT-delimiter absence or wrong-email refusal. Rows keep
// the fixture-manager sample observations; integration harness
// (w-2026-09-11-dave-015) is the surface where the AC-level
// properties become observable.
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

const LIM = 'security-auth-magic-link-REQ-002: REQ-002 does not state token entropy, base64url form or JWT-delimiter absence at the token layer; a probe against session handles from a session manager (TAC-502) needs the integration harness (w-2026-09-11-dave-015).';

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
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM }));
  results.push(deClaim({
    capability,
    verdict: shapeBad.length === 0 ? 'pass' : 'fail',
    detail: `base64url shape sweep at token layer: violations=${JSON.stringify(shapeBad)}`,
    evidence: { shapeBadSample: shapeBad, sampledN: N },
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM }));
  results.push(deClaim({
    capability,
    verdict: jwtShaped.length === 0 ? 'pass' : 'fail',
    detail: `JWT-delimiter absence sweep at token layer: violations=${JSON.stringify(jwtShaped)}`,
    evidence: { jwtShapedSample: jwtShaped, sampledN: N },
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM }));
  return { results, extra: {} };
}
