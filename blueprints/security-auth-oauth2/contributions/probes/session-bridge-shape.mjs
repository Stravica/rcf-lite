// Session-bridge shape probe. Conformance-only per _closure3.md:
// no dispatch of a protected request, no cookie inspection, no
// request.auth population; malformed provider inputs do not
// substitute for missing/invalid session handles. Rows keep local
// bridge observations; integration harness (w-2026-09-11-dave-015)
// is the surface where AC-level properties become observable.
//
// capability: sessionInventory. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = null;
export const capability = 'sessionInventory';
export const accountBound = false;

const LIM_P = 'security-auth-oauth2-AC-10106-1: probe returns a bridged session object; the AC states request.auth carries a Principal on a protected request, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_LEAK = 'security-auth-oauth2-AC-10106-3: probe inspects the bridge return; the AC states request.auth on a protected request does not expose provider tokens, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_H = 'security-auth-oauth2-AC-10101-3: probe inspects a bridge handle string; the AC states the session cookie carries an opaque project handle, needs a real cookie set at the response, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_INV = 'security-auth-oauth2-AC-10106-2: probe uses malformed provider inputs; the AC states a request lacking a valid handle is refused before session issue, needs the integration harness (w-2026-09-11-dave-015).';

export default async function runProbe() {
  const { bridgeSession } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'provider-adapter.mjs')).href);
  const results = [];

  const good = bridgeSession({
    tokenResponse: { access_token: 'tok-abc', expires_in: 3600, scope: 'openid profile' },
    userinfo: { sub: 'user-123', email: 'u@example.com' },
  });
  results.push(deClaim({
    capability,
    verdict: good.ok && good.session && good.session.principalId === 'user-123' ? 'pass' : 'fail',
    detail: `bridge returns session with principalId: ok=${good.ok} principalId=${good.session && good.session.principalId}`,
    evidence: { adapterReturn: good },
  }, { ac: 'security-auth-oauth2-AC-10106-1', limitation: LIM_P }));

  const sessionKeys = good.ok ? Object.keys(good.session) : [];
  const providerTokenLeaks = sessionKeys.filter((k) => /^(access|refresh|id)_?[Tt]oken$/.test(k));
  results.push(deClaim({
    capability,
    verdict: good.ok && providerTokenLeaks.length === 0 ? 'pass' : 'fail',
    detail: `bridge return omits provider tokens: sessionKeys=${JSON.stringify(sessionKeys)} leaks=${JSON.stringify(providerTokenLeaks)}`,
    evidence: { sessionKeys, providerTokenLeaks },
  }, { ac: 'security-auth-oauth2-AC-10106-3', limitation: LIM_LEAK }));

  const handleOk = good.ok
    && typeof good.session.handle === 'string'
    && good.session.handle.length >= 20
    && !good.session.handle.includes('tok-abc');
  results.push(deClaim({
    capability,
    verdict: handleOk ? 'pass' : 'fail',
    detail: `bridge handle is opaque and not derived from access_token: handleLen=${good.session && good.session.handle && good.session.handle.length}`,
    evidence: { handlePrefix: good.session && good.session.handle && good.session.handle.slice(0, 4), handleLen: good.session && good.session.handle && good.session.handle.length },
  }, { ac: 'security-auth-oauth2-AC-10101-3', limitation: LIM_H }));

  const missingSub = bridgeSession({ tokenResponse: { access_token: 'tok-abc' }, userinfo: {} });
  results.push(deClaim({
    capability,
    verdict: !missingSub.ok && /userinfo\.sub/.test(missingSub.error) ? 'pass' : 'fail',
    detail: `bridge refuses missing userinfo.sub: ok=${missingSub.ok} error=${JSON.stringify(missingSub.error)}`,
    evidence: { adapterReturn: missingSub },
  }, { ac: 'security-auth-oauth2-AC-10106-2', limitation: LIM_INV }));

  const missingTok = bridgeSession({ tokenResponse: {}, userinfo: { sub: 'x' } });
  results.push(deClaim({
    capability,
    verdict: !missingTok.ok && /access_token/.test(missingTok.error) ? 'pass' : 'fail',
    detail: `bridge refuses missing access_token: ok=${missingTok.ok} error=${JSON.stringify(missingTok.error)}`,
    evidence: { adapterReturn: missingTok },
  }, { ac: 'security-auth-oauth2-AC-10106-2', limitation: LIM_INV }));

  return { results, extra: {} };
}
