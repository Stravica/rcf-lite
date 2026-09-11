// Token-entropy shape probe. Issues 200 tokens against the fixture
// manager and asserts no collisions; asserts the tokens are
// base64url-only and at least 32 chars (256 bits of entropy from
// 32 random bytes per TAC-501 default).
//
// capability: principalDirectory.
// anchorAcId: security-auth-magic-link-AC-3102-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = 'security-auth-magic-link-AC-3102-1';
export const capability = 'principalDirectory';
export const accountBound = false;

export default async function runProbe() {
  const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);
  const mgr = createMagicLinkManager({ ttlSeconds: 900 });
  const tokens = new Set();
  const N = 200;
  for (let i = 0; i < N; i++) {
    const { token } = await mgr.issue({ emailAddress: `u${i}@example.com` });
    tokens.add(token);
  }
  const results = [];
  results.push({
    anchorAcId,
    capability,
    verdict: tokens.size === N ? 'pass' : 'fail',
    detail: `token uniqueness across ${N} issues: unique=${tokens.size}`,
    evidence: { uniqueCount: tokens.size, requested: N },
  });
  let allValidShape = true;
  const bad = [];
  for (const t of tokens) {
    if (!/^[A-Za-z0-9_-]+$/.test(t) || t.length < 32) { allValidShape = false; bad.push({ len: t.length, sample: t.slice(0, 6) }); if (bad.length >= 3) break; }
  }
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3102-2',
    capability,
    verdict: allValidShape ? 'pass' : 'fail',
    detail: `token shape base64url+len>=32: ok=${allValidShape} bad=${JSON.stringify(bad)}`,
    evidence: { allValidShape, badSample: bad },
  });
  return { results, extra: {} };
}
