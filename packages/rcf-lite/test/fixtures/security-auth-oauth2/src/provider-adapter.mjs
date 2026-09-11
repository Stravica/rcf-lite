// Provider adapter for security-auth-oauth2 fixture. Chooses the
// discovery URL (issuer + /.well-known/openid-configuration per
// OpenID Connect Discovery 1.0
// https://openid.net/specs/openid-connect-discovery-1_0.html
// verifiedOn 2026-09-11) from an issuer URL and refuses http:// in
// production mode (per RFC 6749 sec 3.1 the token endpoint MUST use
// TLS in production).

export function chooseDiscoveryUrl(issuer, { allowInsecure = false } = {}) {
  if (typeof issuer !== 'string' || !issuer) return { ok: false, error: 'issuer must be a non-empty string' };
  if (!allowInsecure && !issuer.startsWith('https://')) {
    return { ok: false, error: `issuer must use https in production; observed ${issuer}` };
  }
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return { ok: true, discoveryUrl: `${trimmed}/.well-known/openid-configuration` };
}

// Session bridge shape: maps token + userinfo into the app's session shape.
// Rule: the reduced session shape MUST NOT expose provider tokens on
// request.auth per story-10106 AC-10106-3. The bridge stores nothing that
// would leak the access token to route handlers; the handle the browser
// receives is an opaque project session id, minted here as a random
// string. The provider token is deliberately absent from the returned
// session object.
import { randomBytes } from 'node:crypto';

export function bridgeSession({ tokenResponse, userinfo }) {
  if (!tokenResponse || !tokenResponse.access_token) return { ok: false, error: 'missing access_token' };
  if (!userinfo || !userinfo.sub) return { ok: false, error: 'missing userinfo.sub' };
  return {
    ok: true,
    session: {
      // Opaque project session handle; not derived from any provider token.
      handle: `pss_${randomBytes(24).toString('base64url')}`,
      // Reduced principal exposed on request.auth. NO provider tokens.
      principalId: userinfo.sub,
      scope: tokenResponse.scope || '',
      expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
    },
  };
}

// Provider selector: pick the correct adapter for a given provider name.
const KNOWN_PROVIDERS = Object.freeze(['auth0', 'google', 'github', 'okta', 'generic-oidc']);
export function selectProvider(name) {
  if (!KNOWN_PROVIDERS.includes(name)) {
    return { ok: false, error: `unknown provider: ${name}; known=${JSON.stringify(KNOWN_PROVIDERS)}` };
  }
  return { ok: true, provider: name };
}
export const knownProviders = KNOWN_PROVIDERS;
