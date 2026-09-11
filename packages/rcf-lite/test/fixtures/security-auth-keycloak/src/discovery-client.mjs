// TAC-1201 Keycloak discovery client shape. Builds the realm's
// OIDC discovery URL and validates a returned config document
// carries the mandatory endpoints per OpenID Connect Discovery 1.0
// section 3
// (https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig
// verifiedOn 2026-09-11).

const REQUIRED_FIELDS = Object.freeze([
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
]);

export function buildDiscoveryUrl({ baseUrl, realm }) {
  if (!baseUrl || !realm) return { ok: false, error: 'baseUrl and realm are required' };
  if (!/^https:\/\//.test(baseUrl)) return { ok: false, error: `baseUrl must be https; observed ${baseUrl}` };
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return { ok: true, discoveryUrl: `${trimmed}/realms/${encodeURIComponent(realm)}/.well-known/openid-configuration` };
}

export function validateDiscoveryDocument(doc) {
  const missing = REQUIRED_FIELDS.filter((k) => typeof doc?.[k] !== 'string' || !doc[k]);
  if (missing.length > 0) return { ok: false, error: `discovery doc missing required fields: ${missing.join(',')}` };
  return { ok: true, endpoints: {
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
    issuer: doc.issuer,
  } };
}
