// Magic-link token issue+verify shape probe. Exercises the TAC-501
// manager contract: single-use, TTL-bounded, email-bound token
// with constant-time email comparison at verify. Refuses on wrong
// email, expired token, and second-use replay.
//
// capability: principalDirectory (magic-link is the sole
//   principal-directory verb this blueprint declares).
// anchorAcId: security-auth-magic-link-AC-3101-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = 'security-auth-magic-link-AC-3101-1';
export const capability = 'principalDirectory';
export const accountBound = false;

export default async function runProbe() {
  const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);

  const results = [];
  let now = 1_000_000_000_000; // fixed clock
  const mgr = createMagicLinkManager({ ttlSeconds: 900, clock: () => now });

  // Issue
  const issued = await mgr.issue({ emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId,
    capability,
    verdict: issued.ok && typeof issued.token === 'string' && issued.token.length >= 32 ? 'pass' : 'fail',
    detail: `issue: ok=${issued.ok} tokenLen=${issued.token && issued.token.length} expiresAt=${issued.expiresAt}`,
    evidence: { adapterReturn: { ok: issued.ok, tokenLen: issued.token && issued.token.length, expiresAt: issued.expiresAt } },
  });

  // Wrong email refused
  const wrongEmail = await mgr.verify({ token: issued.token, emailAddress: 'mallory@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3101-2',
    capability,
    verdict: !wrongEmail.ok && /email does not match/.test(wrongEmail.error) ? 'pass' : 'fail',
    detail: `verify wrong-email refusal: ok=${wrongEmail.ok} error=${JSON.stringify(wrongEmail.error)}`,
    evidence: { adapterReturn: wrongEmail },
  });

  // Correct verify succeeds
  const good = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3101-3',
    capability,
    verdict: good.ok && good.emailAddress === 'alice@example.com' ? 'pass' : 'fail',
    detail: `verify happy: ok=${good.ok} emailAddress=${good.emailAddress}`,
    evidence: { adapterReturn: good },
  });

  // Replay refused
  const replay = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3101-4',
    capability,
    verdict: !replay.ok && /already consumed/.test(replay.error) ? 'pass' : 'fail',
    detail: `verify replay refusal: ok=${replay.ok} error=${JSON.stringify(replay.error)}`,
    evidence: { adapterReturn: replay },
  });

  // Expired token refused
  const issued2 = await mgr.issue({ emailAddress: 'bob@example.com' });
  now += 901_000; // advance beyond TTL
  const expired = await mgr.verify({ token: issued2.token, emailAddress: 'bob@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3101-5',
    capability,
    verdict: !expired.ok && /expired/.test(expired.error) ? 'pass' : 'fail',
    detail: `verify expired refusal: ok=${expired.ok} error=${JSON.stringify(expired.error)}`,
    evidence: { adapterReturn: expired },
  });

  return { results, extra: {} };
}
