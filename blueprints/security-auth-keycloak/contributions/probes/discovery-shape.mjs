// Discovery-URL shape probe for security-auth-keycloak. Exercises
// TAC-1201 discovery client: given baseUrl + realm, the discovery
// URL is realm-scoped and https-only. A returned document must
// carry the mandatory OIDC endpoints per Discovery 1.0 sec 3
// (issuer, authorization_endpoint, token_endpoint, jwks_uri).
//
// capability: principalDirectory (directory endpoints are the
//   prerequisite for every downstream operation).
// anchorAcId: security-auth-keycloak-AC-11101-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-keycloak', 'src');

export const anchorAcId = 'security-auth-keycloak-AC-11101-1';
export const capability = 'principalDirectory';
export const accountBound = false;

export default async function runProbe() {
  const { buildDiscoveryUrl, validateDiscoveryDocument } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'discovery-client.mjs')).href);
  const results = [];

  const built = buildDiscoveryUrl({ baseUrl: 'https://keycloak.example.com/', realm: 'stravica-dev' });
  const expected = 'https://keycloak.example.com/realms/stravica-dev/.well-known/openid-configuration';
  results.push({
    anchorAcId,
    capability,
    verdict: built.ok && built.discoveryUrl === expected ? 'pass' : 'fail',
    detail: `discovery URL: ok=${built.ok} url=${built.discoveryUrl}`,
    evidence: { input: { baseUrl: 'https://keycloak.example.com/', realm: 'stravica-dev' }, adapterReturn: built },
    vendorCitation: { url: 'https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig', verifiedOn: '2026-09-11' },
  });

  const insecure = buildDiscoveryUrl({ baseUrl: 'http://insecure.example.com', realm: 'stravica-dev' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11101-2',
    capability,
    verdict: !insecure.ok && /must be https/.test(insecure.error) ? 'pass' : 'fail',
    detail: `discovery insecure refusal: ok=${insecure.ok} error=${JSON.stringify(insecure.error)}`,
    evidence: { adapterReturn: insecure },
  });

  const missing = validateDiscoveryDocument({ issuer: 'x', authorization_endpoint: 'x' });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11101-3',
    capability,
    verdict: !missing.ok && /missing required fields/.test(missing.error) ? 'pass' : 'fail',
    detail: `discovery doc missing-fields refusal: ok=${missing.ok} error=${JSON.stringify(missing.error)}`,
    evidence: { validatorReturn: missing },
  });

  const good = validateDiscoveryDocument({
    issuer: 'https://kc.example.com/realms/dev',
    authorization_endpoint: 'https://kc.example.com/realms/dev/protocol/openid-connect/auth',
    token_endpoint: 'https://kc.example.com/realms/dev/protocol/openid-connect/token',
    jwks_uri: 'https://kc.example.com/realms/dev/protocol/openid-connect/certs',
  });
  results.push({
    anchorAcId: 'security-auth-keycloak-AC-11101-4',
    capability,
    verdict: good.ok ? 'pass' : 'fail',
    detail: `discovery doc happy: ok=${good.ok} endpoints=${JSON.stringify(good.endpoints || good.error)}`,
    evidence: { validatorReturn: good },
  });
  return { results, extra: {} };
}
