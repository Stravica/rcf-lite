// Magic-link token issue+verify shape probe. Conformance-only for
// most rows per _closure3.md: manager calls do not observe
// GET /login/verify, HTTP 401 or absence of session issue, and
// REQ-002 does not state high entropy, base64url form or
// wrong-email refusal. AC-3102-3 (default TTL enumerable at
// runtime) is kept undisputed by the closure: the probe observes
// the manager's effective ttl configuration, which is the
// "enumerable at runtime" clause of AC-3102-3.
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

const LIM_TTL = 'security-auth-magic-link-AC-3102-3: probe checks the config constant on the manager; the AC states the recorded expiresAt is fifteen minutes after the mint clock on issued tokens, needs the integration harness (the auth integration harness follow-up).';
const LIM_ISSUE = 'security-auth-magic-link-REQ-002: probe calls manager.issue directly; REQ-002 does not state a manager-level issue shape, and route-level issue semantics need the integration harness (the auth integration harness follow-up).';
const LIM_EMAIL = 'security-auth-magic-link-REQ-002: probe calls manager.verify with a wrong email; REQ-002 does not state wrong-email refusal semantics, and route-level GET /login/verify observation needs the integration harness (the auth integration harness follow-up).';
const LIM_HAPPY = 'security-auth-magic-link-REQ-002: probe calls manager.verify happy path; REQ-002 does not state a manager-level happy path, and route-level GET /login/verify observation needs the integration harness (the auth integration harness follow-up).';
const LIM_REPLAY = 'security-auth-magic-link-AC-3102-1: probe calls manager.verify twice; the AC states GET /login/verify returns 401 with no Set-Cookie on the second call, needs the integration harness (the auth integration harness follow-up).';
const LIM_EXPIRED = 'security-auth-magic-link-AC-3102-2: probe calls manager.verify past expiry; the AC states GET /login/verify returns 401 with no Set-Cookie, needs the integration harness (the auth integration harness follow-up).';

export default async function runProbe() {
  const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);

  const results = [];
  let now = 1_000_000_000_000;

  const mgrDefault = createMagicLinkManager({ clock: () => now });
  const defaultTtl = typeof mgrDefault.ttlSeconds === 'number' ? mgrDefault.ttlSeconds : mgrDefault.getTtlSeconds && mgrDefault.getTtlSeconds();
  results.push(deClaim({
    capability,
    verdict: defaultTtl === 900 ? 'pass' : 'fail',
    detail: `manager.ttlSeconds default config observation: observed=${defaultTtl}`,
    evidence: { defaultTtlSeconds: defaultTtl, expected: 900 },
  }, { ac: 'security-auth-magic-link-AC-3102-3', limitation: LIM_TTL }));

  const mgr = createMagicLinkManager({ ttlSeconds: 900, clock: () => now });

  const issued = await mgr.issue({ emailAddress: 'alice@example.com' });
  results.push(deClaim({
    capability,
    verdict: issued.ok && typeof issued.token === 'string' && issued.token.length >= 32 ? 'pass' : 'fail',
    detail: `manager.issue returned a token: ok=${issued.ok} tokenLen=${issued.token && issued.token.length} expiresAt=${issued.expiresAt}`,
    evidence: { adapterReturn: { ok: issued.ok, tokenLen: issued.token && issued.token.length, expiresAt: issued.expiresAt } },
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM_ISSUE }));

  const wrongEmail = await mgr.verify({ token: issued.token, emailAddress: 'mallory@example.com' });
  results.push(deClaim({
    capability,
    verdict: !wrongEmail.ok && /email does not match/.test(wrongEmail.error) ? 'pass' : 'fail',
    detail: `manager.verify wrong-email refusal: ok=${wrongEmail.ok} error=${JSON.stringify(wrongEmail.error)}`,
    evidence: { adapterReturn: wrongEmail },
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM_EMAIL }));

  const good = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push(deClaim({
    capability,
    verdict: good.ok && good.emailAddress === 'alice@example.com' ? 'pass' : 'fail',
    detail: `manager.verify happy path: ok=${good.ok} emailAddress=${good.emailAddress}`,
    evidence: { adapterReturn: good },
  }, { ac: 'security-auth-magic-link-REQ-002', limitation: LIM_HAPPY }));

  const replay = await mgr.verify({ token: issued.token, emailAddress: 'alice@example.com' });
  results.push(deClaim({
    capability,
    verdict: !replay.ok && /already consumed/.test(replay.error) ? 'pass' : 'fail',
    detail: `manager.verify replay refusal: ok=${replay.ok} error=${JSON.stringify(replay.error)}`,
    evidence: { adapterReturn: replay },
  }, { ac: 'security-auth-magic-link-AC-3102-1', limitation: LIM_REPLAY }));

  const issued2 = await mgr.issue({ emailAddress: 'bob@example.com' });
  now += 901_000;
  const expired = await mgr.verify({ token: issued2.token, emailAddress: 'bob@example.com' });
  results.push(deClaim({
    capability,
    verdict: !expired.ok && /expired/.test(expired.error) ? 'pass' : 'fail',
    detail: `manager.verify past-expiry refusal: ok=${expired.ok} error=${JSON.stringify(expired.error)}`,
    evidence: { adapterReturn: expired, clockAdvancedByMs: 901_000 },
  }, { ac: 'security-auth-magic-link-AC-3102-2', limitation: LIM_EXPIRED }));

  return { results, extra: {} };
}
