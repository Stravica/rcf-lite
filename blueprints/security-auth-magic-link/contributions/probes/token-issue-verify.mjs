// Magic-link token issue+verify shape probe. Exercises the TAC-501
// manager contract: single-use, TTL-bounded, email-bound token with
// constant-time email comparison at verify. Refuses on wrong email,
// expired token, and second-use replay.
//
// capability: principalDirectory (magic-link is the sole
//   principal-directory verb this blueprint declares).
// Anchors (per closure): AC-3102-1 (single-use replay refused),
//   AC-3102-2 (expired token refused), AC-3102-3 (default TTL
//   fifteen minutes; the window is a project-configurable option
//   enumerable at runtime).
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

  const results = [];
  let now = 1_000_000_000_000; // fixed clock

  // AC-3102-3: the DEFAULT token expiry window is fifteen minutes.
  // Construct the manager with no ttlSeconds override; assert the
  // effective ttl the manager reports equals 900 seconds.
  const mgrDefault = createMagicLinkManager({ clock: () => now });
  const defaultTtl = typeof mgrDefault.ttlSeconds === 'number' ? mgrDefault.ttlSeconds : mgrDefault.getTtlSeconds && mgrDefault.getTtlSeconds();
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3102-3',
    capability,
    verdict: defaultTtl === 900 ? 'pass' : 'fail',
    detail: `AC-3102-3 (default TTL is fifteen minutes): observed defaultTtlSeconds=${defaultTtl}`,
    evidence: { defaultTtlSeconds: defaultTtl, expected: 900 },
  });

  const mgr = createMagicLinkManager({ ttlSeconds: 900, clock: () => now });

  // Issue (precondition for downstream ACs; no AC covers issue
  // shape at the manager level - anchor REQ-002).
  const issued = await mgr.issue({ emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-REQ-002',
    capability,
    verdict: issued.ok && typeof issued.token === 'string' && issued.token.length >= 32 ? 'pass' : 'fail',
    detail: `REQ-002 (issue produces a single-use TTL-bounded token; no AC states the manager-level issue shape, anchoring REQ). ok=${issued.ok} tokenLen=${issued.token && issued.token.length} expiresAt=${issued.expiresAt}`,
    evidence: { adapterReturn: { ok: issued.ok, tokenLen: issued.token && issued.token.length, expiresAt: issued.expiresAt } },
  });

  // Wrong email refused (no AC covers email binding at the manager
  // level directly; anchor REQ-002).
  const wrongEmail = await mgr.verify({ token: issued.token, emailAddress: 'mallory@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-REQ-002',
    capability,
    verdict: !wrongEmail.ok && /email does not match/.test(wrongEmail.error) ? 'pass' : 'fail',
    detail: `REQ-002 (wrong-email verify refused; no AC states the manager-level email-binding refusal, anchoring REQ). ok=${wrongEmail.ok} error=${JSON.stringify(wrongEmail.error)}`,
    evidence: { adapterReturn: wrongEmail },
  });

  // Correct verify succeeds - precondition for the replay check.
  const good = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-REQ-002',
    capability,
    verdict: good.ok && good.emailAddress === 'alice@example.com' ? 'pass' : 'fail',
    detail: `REQ-002 (well-formed verify succeeds; no AC states the manager-level happy path, anchoring REQ). ok=${good.ok} emailAddress=${good.emailAddress}`,
    evidence: { adapterReturn: good },
  });

  // AC-3102-1: single-use replay refused.
  const replay = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push({
    anchorAcId,
    capability,
    verdict: !replay.ok && /already consumed/.test(replay.error) ? 'pass' : 'fail',
    detail: `AC-3102-1 (single-use: replay of consumed token refused): ok=${replay.ok} error=${JSON.stringify(replay.error)}`,
    evidence: { adapterReturn: replay },
  });

  // AC-3102-2: expired token refused. Advance clock past the ttl.
  const issued2 = await mgr.issue({ emailAddress: 'bob@example.com' });
  now += 901_000; // > 900 seconds
  const expired = await mgr.verify({ token: issued2.token, emailAddress: 'bob@example.com' });
  results.push({
    anchorAcId: 'security-auth-magic-link-AC-3102-2',
    capability,
    verdict: !expired.ok && /expired/.test(expired.error) ? 'pass' : 'fail',
    detail: `AC-3102-2 (past-expiry verify refused): ok=${expired.ok} error=${JSON.stringify(expired.error)}`,
    evidence: { adapterReturn: expired, clockAdvancedByMs: 901_000 },
  });

  return { results, extra: {} };
}
