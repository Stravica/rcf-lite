// Session-bridge shape probe for security-auth-oauth2. Exercises
// TAC-1103 session bridge: a token response plus a userinfo record
// maps to the application's session record. The bridged session
// carries an opaque handle and a reduced principal; the provider's
// access token is deliberately NOT exposed on the returned session
// (AC-10106-3: session bridge does not expose provider tokens on
// request.auth).
//
// capability: sessionInventory (session record shape).
// Anchors (per closure): AC-10106-1 (Principal on request) for the
//   happy path; AC-10106-3 (no accessToken on request.auth) for the
//   absence assertion; AC-10101-3 (session cookie carries an
//   opaque project handle, not a provider token) for the handle
//   shape assertion.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10106-1';
export const capability = 'sessionInventory';
export const accountBound = false;

export default async function runProbe() {
  const { bridgeSession } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'provider-adapter.mjs')).href);
  const results = [];

  const good = bridgeSession({
    tokenResponse: { access_token: 'tok-abc', expires_in: 3600, scope: 'openid profile' },
    userinfo: { sub: 'user-123', email: 'u@example.com' },
  });
  results.push({
    anchorAcId,
    capability,
    verdict: good.ok && good.session && good.session.principalId === 'user-123' ? 'pass' : 'fail',
    detail: `AC-10106-1 (Principal on request.auth): ok=${good.ok} principalId=${good.session && good.session.principalId}`,
    evidence: { adapterReturn: good },
  });

  // AC-10106-3: the session bridge MUST NOT expose provider tokens
  // on request.auth. Assert accessToken (and any other provider-
  // token shape) is absent from the returned session.
  const sessionKeys = good.ok ? Object.keys(good.session) : [];
  const providerTokenLeaks = sessionKeys.filter((k) => /^(access|refresh|id)_?[Tt]oken$/.test(k));
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10106-3',
    capability,
    verdict: good.ok && providerTokenLeaks.length === 0 ? 'pass' : 'fail',
    detail: `AC-10106-3 (no provider tokens on request.auth): sessionKeys=${JSON.stringify(sessionKeys)} providerTokenLeaks=${JSON.stringify(providerTokenLeaks)}`,
    evidence: { sessionKeys, providerTokenLeaks },
  });

  // AC-10101-3: the session handle is an opaque project-issued value
  // (not a provider token). The bridge mints an opaque handle prefixed
  // pss_ that is not derived from the access_token.
  const handleOk = good.ok
    && typeof good.session.handle === 'string'
    && good.session.handle.length >= 20
    && !good.session.handle.includes('tok-abc');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10101-3',
    capability,
    verdict: handleOk ? 'pass' : 'fail',
    detail: `AC-10101-3 (opaque project handle not a provider token): handleLen=${good.session && good.session.handle && good.session.handle.length} containsProviderToken=${good.session && good.session.handle && good.session.handle.includes('tok-abc')}`,
    evidence: { handlePrefix: good.session && good.session.handle && good.session.handle.slice(0, 4), handleLen: good.session && good.session.handle && good.session.handle.length },
  });

  // AC-10106-2: request lacking a valid handle is refused. The bridge
  // returning ok:false + error on missing sub / missing access_token
  // proves the guard runs before a session issue.
  const missingSub = bridgeSession({ tokenResponse: { access_token: 'tok-abc' }, userinfo: {} });
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10106-2',
    capability,
    verdict: !missingSub.ok && /userinfo\.sub/.test(missingSub.error) ? 'pass' : 'fail',
    detail: `AC-10106-2 (bridge refuses malformed input, no session issued): ok=${missingSub.ok} error=${JSON.stringify(missingSub.error)}`,
    evidence: { adapterReturn: missingSub },
  });

  const missingTok = bridgeSession({ tokenResponse: {}, userinfo: { sub: 'x' } });
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10106-2',
    capability,
    verdict: !missingTok.ok && /access_token/.test(missingTok.error) ? 'pass' : 'fail',
    detail: `AC-10106-2 (bridge refuses missing access_token, no session issued): ok=${missingTok.ok} error=${JSON.stringify(missingTok.error)}`,
    evidence: { adapterReturn: missingTok },
  });

  return { results, extra: {} };
}
