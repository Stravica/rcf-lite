// OIDC discovery-URL derivation and document-shape probe for
// security-auth-keycloak. Conformance-only per _closure3.md:
// URL construction and document validation are not the
// boot-time fetch/population/refusal properties the ACs state.
// Rows keep their observations against the fixture discovery
// client; integration-harness follow-up (w-2026-09-11-dave-015)
// is the surface where AC-level properties become observable.
//
// capability: principalDirectory. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = null;
export const capability = 'principalDirectory';
export const accountBound = false;

const LIM_URL = 'security-auth-keycloak-AC-11102-1: probe checks URL derivation and doc-shape refusal only; the AC states the boot-time discovery fetch fills a cache read at request time, which needs a real Keycloak realm and boot lifecycle (integration harness w-2026-09-11-dave-015).';
const LIM_REFUSAL = 'security-auth-keycloak-AC-11102-3: probe checks validator refusal only; the AC states the boot itself refuses when the discovery document is malformed, which needs the boot lifecycle (integration harness w-2026-09-11-dave-015).';

export default async function runProbe() {
  const { buildDiscoveryUrl, validateDiscoveryDocument } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'discovery-client.mjs')).href);
  const results = [];

  const built = buildDiscoveryUrl({ baseUrl: 'https://keycloak.example.com/', realm: 'example-realm' });
  const expected = 'https://keycloak.example.com/realms/example-realm/.well-known/openid-configuration';
  results.push(deClaim({
    capability,
    verdict: built.ok && built.discoveryUrl === expected ? 'pass' : 'fail',
    detail: `discovery URL construction (well-formed input): ok=${built.ok} url=${built.discoveryUrl}`,
    evidence: { input: { baseUrl: 'https://keycloak.example.com/', realm: 'example-realm' }, adapterReturn: built },
  }, { ac: 'security-auth-keycloak-AC-11102-1', limitation: LIM_URL }));

  const insecure = buildDiscoveryUrl({ baseUrl: 'http://insecure.example.com', realm: 'example-realm' });
  results.push(deClaim({
    capability,
    verdict: !insecure.ok && /must be https/.test(insecure.error) ? 'pass' : 'fail',
    detail: `insecure baseUrl refusal: ok=${insecure.ok} error=${JSON.stringify(insecure.error)}`,
    evidence: { adapterReturn: insecure },
  }, { ac: 'security-auth-keycloak-AC-11102-1', limitation: LIM_URL }));

  const missing = validateDiscoveryDocument({ issuer: 'x', authorization_endpoint: 'x' });
  results.push(deClaim({
    capability,
    verdict: !missing.ok && /missing required fields/.test(missing.error) ? 'pass' : 'fail',
    detail: `doc-shape missing-fields refusal: ok=${missing.ok} error=${JSON.stringify(missing.error)}`,
    evidence: { validatorReturn: missing },
  }, { ac: 'security-auth-keycloak-AC-11102-3', limitation: LIM_REFUSAL }));

  const good = validateDiscoveryDocument({
    issuer: 'https://kc.example.com/realms/dev',
    authorization_endpoint: 'https://kc.example.com/realms/dev/protocol/openid-connect/auth',
    token_endpoint: 'https://kc.example.com/realms/dev/protocol/openid-connect/token',
    jwks_uri: 'https://kc.example.com/realms/dev/protocol/openid-connect/certs',
  });
  results.push(deClaim({
    capability,
    verdict: good.ok ? 'pass' : 'fail',
    detail: `well-formed doc passes validation: ok=${good.ok} endpoints=${JSON.stringify(good.endpoints || good.error)}`,
    evidence: { validatorReturn: good },
  }, { ac: 'security-auth-keycloak-AC-11102-1', limitation: LIM_URL }));

  return { results, extra: {} };
}
