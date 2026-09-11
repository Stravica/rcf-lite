// Session-bridge shape probe for security-auth-oauth2. Exercises
// TAC-1103 session bridge: a token response plus a userinfo record
// maps to the application's session record. Refuses on missing
// access_token or missing userinfo.sub.
//
// capability: sessionInventory (session record shape),
//   hostedIdentityUi (hosted-flow completion carrier).
// anchorAcId: security-auth-oauth2-AC-10103-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10103-1';
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
    verdict: good.ok && good.session.principalId === 'user-123' && good.session.accessToken === 'tok-abc' ? 'pass' : 'fail',
    detail: `session-bridge happy: ok=${good.ok} principalId=${good.session && good.session.principalId} scope=${good.session && good.session.scope}`,
    evidence: { adapterReturn: good },
  });

  const missingSub = bridgeSession({ tokenResponse: { access_token: 'tok-abc' }, userinfo: {} });
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10103-2',
    capability,
    verdict: !missingSub.ok && /userinfo.sub/.test(missingSub.error) ? 'pass' : 'fail',
    detail: `session-bridge refuses missing sub: ok=${missingSub.ok} error=${JSON.stringify(missingSub.error)}`,
    evidence: { adapterReturn: missingSub },
  });

  const missingTok = bridgeSession({ tokenResponse: {}, userinfo: { sub: 'x' } });
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10103-3',
    capability,
    verdict: !missingTok.ok && /access_token/.test(missingTok.error) ? 'pass' : 'fail',
    detail: `session-bridge refuses missing access_token: ok=${missingTok.ok} error=${JSON.stringify(missingTok.error)}`,
    evidence: { adapterReturn: missingTok },
  });

  return { results, extra: {} };
}
