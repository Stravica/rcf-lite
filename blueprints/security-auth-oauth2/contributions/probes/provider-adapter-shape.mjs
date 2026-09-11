// Provider-adapter shape probe for security-auth-oauth2. Exercises
// the TAC-1102 provider adapter surface: an issuer URL maps to a
// deterministic OpenID Connect discovery URL, an http:// issuer is
// refused in production mode (RFC 6749 sec 3.1 TLS requirement),
// and only known provider names are selectable through TAC-1104
// provider-selector.
//
// capability: principalDirectory (adapter shape observation),
//   credentialSelfService (provider selector observation).
// Anchors (per closure): AC-10111-2 covers the missing-field refusal
//   the discovery/insecure paths exercise (validator refuses records
//   missing REQ-002 mandated fields with a stable-coded error);
//   AC-10109-2 covers the unknown-provider refusal the selector
//   exercises.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2', 'src');

export const anchorAcId = 'security-auth-oauth2-AC-10111-2';
export const capability = 'principalDirectory';
export const accountBound = false;

export default async function runProbe() {
  const { chooseDiscoveryUrl, selectProvider, knownProviders } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'provider-adapter.mjs')).href);
  const results = [];

  // Happy path: the validator accepts a well-formed https issuer and
  // resolves the discovery URL. Observing the derived URL proves the
  // validator ran a well-formed record end to end.
  const good = chooseDiscoveryUrl('https://accounts.example.com/');
  results.push({
    anchorAcId,
    capability,
    verdict: good.ok && good.discoveryUrl === 'https://accounts.example.com/.well-known/openid-configuration' ? 'pass' : 'fail',
    detail: `AC-10111-2 happy path: adapter accepts a well-formed record. discoveryUrl=${good.discoveryUrl}`,
    evidence: { input: 'https://accounts.example.com/', adapterReturn: good },
    vendorCitation: { url: 'https://openid.net/specs/openid-connect-discovery-1_0.html', verifiedOn: '2026-09-11' },
  });

  // Refusal: http:// issuer (REQ-002 TLS-mandate) fails validation
  // with a stable-coded error naming the property.
  const insecure = chooseDiscoveryUrl('http://insecure.example.com');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10111-2',
    capability,
    verdict: !insecure.ok && /must use https/.test(insecure.error) ? 'pass' : 'fail',
    detail: `AC-10111-2 refusal path: insecure-issuer refused with named stable error. error=${JSON.stringify(insecure.error)}`,
    evidence: { input: 'http://insecure.example.com', adapterReturn: insecure },
    vendorCitation: { url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-3.1', verifiedOn: '2026-09-11' },
  });

  // Selector happy path: a provider name in the config list resolves.
  const knownOk = selectProvider('auth0');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10109-1',
    capability: 'credentialSelfService',
    verdict: knownOk.ok && knownOk.provider === 'auth0' ? 'pass' : 'fail',
    detail: `AC-10109-1 (selector known-name): ok=${knownOk.ok} provider=${knownOk.provider}`,
    evidence: { adapterReturn: knownOk, knownProviders },
  });

  // Selector refusal: a provider name absent from the config list
  // refuses before any redirect (AC-10109-2).
  const unknownRef = selectProvider('atlantis-single-signon');
  results.push({
    anchorAcId: 'security-auth-oauth2-AC-10109-2',
    capability: 'credentialSelfService',
    verdict: !unknownRef.ok && /unknown provider/.test(unknownRef.error) ? 'pass' : 'fail',
    detail: `AC-10109-2 (selector refuses unknown provider): ok=${unknownRef.ok} error=${JSON.stringify(unknownRef.error)}`,
    evidence: { adapterReturn: unknownRef },
  });

  return { results, extra: {} };
}
