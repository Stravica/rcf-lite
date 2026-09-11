// Provider-adapter shape probe. Conformance-only per _closure3.md:
// validator/selector calls do not exercise the missing-field,
// boot/listener/event/controller behaviour the ACs bind; the
// second-provider round trip and project session redirects are
// not exercised. Rows keep local adapter observations; integration
// harness (w-2026-09-11-dave-015) is where AC-level properties
// become observable.
//
// capability: principalDirectory. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = null;
export const capability = 'principalDirectory';
export const accountBound = false;

const LIM_VAL = 'security-auth-oauth2-AC-10111-2: probe calls a validator helper; the AC states the mechanism refuses at boot with a stable-coded error, needs the boot lifecycle (integration harness w-2026-09-11-dave-015).';
const LIM_SEL1 = 'security-auth-oauth2-AC-10109-1: probe checks selector known-name only; the AC states the second-provider sign-in round-trip issues a project session, needs the integration harness (w-2026-09-11-dave-015).';
const LIM_SEL2 = 'security-auth-oauth2-AC-10109-2: probe calls a selector helper; the AC states the sign-in route refuses an unknown provider and the redirect guard blocks it, needs the integration harness (w-2026-09-11-dave-015).';

export default async function runProbe() {
  const { chooseDiscoveryUrl, selectProvider, knownProviders } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'provider-adapter.mjs')).href);
  const results = [];

  const good = chooseDiscoveryUrl('https://accounts.example.com/');
  results.push(deClaim({
    capability,
    verdict: good.ok && good.discoveryUrl === 'https://accounts.example.com/.well-known/openid-configuration' ? 'pass' : 'fail',
    detail: `validator accepts well-formed https issuer: discoveryUrl=${good.discoveryUrl}`,
    evidence: { input: 'https://accounts.example.com/', adapterReturn: good },
    vendorCitation: { url: 'https://openid.net/specs/openid-connect-discovery-1_0.html', verifiedOn: '2026-09-11' },
  }, { ac: 'security-auth-oauth2-AC-10111-2', limitation: LIM_VAL }));

  const insecure = chooseDiscoveryUrl('http://insecure.example.com');
  results.push(deClaim({
    capability,
    verdict: !insecure.ok && /must use https/.test(insecure.error) ? 'pass' : 'fail',
    detail: `insecure-issuer refused (helper level): error=${JSON.stringify(insecure.error)}`,
    evidence: { input: 'http://insecure.example.com', adapterReturn: insecure },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-3.1', verifiedOn: '2026-09-11' },
  }, { ac: 'security-auth-oauth2-AC-10111-2', limitation: LIM_VAL }));

  const knownOk = selectProvider('auth0');
  results.push(deClaim({
    capability: 'credentialSelfService',
    verdict: knownOk.ok && knownOk.provider === 'auth0' ? 'pass' : 'fail',
    detail: `selector known-name resolves: ok=${knownOk.ok} provider=${knownOk.provider}`,
    evidence: { adapterReturn: knownOk, knownProviders },
  }, { ac: 'security-auth-oauth2-AC-10109-1', limitation: LIM_SEL1 }));

  const unknownRef = selectProvider('atlantis-single-signon');
  results.push(deClaim({
    capability: 'credentialSelfService',
    verdict: !unknownRef.ok && /unknown provider/.test(unknownRef.error) ? 'pass' : 'fail',
    detail: `selector refuses unknown provider (helper level): error=${JSON.stringify(unknownRef.error)}`,
    evidence: { adapterReturn: unknownRef },
  }, { ac: 'security-auth-oauth2-AC-10109-2', limitation: LIM_SEL2 }));

  return { results, extra: {} };
}
