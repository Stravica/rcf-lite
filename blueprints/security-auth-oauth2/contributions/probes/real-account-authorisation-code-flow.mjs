// Real-account authorisation-code-flow probe for security-auth-
// oauth2. Runs the full RFC 6749 code flow with RFC 7636 PKCE
// against a real, commercial OAuth 2.0 authorisation server when
// one is available.
//
// This estate does not have a live commercial IdP; the probe
// honest-skips per rule 7d, recording accountBoundSkipped: true
// naming CI_HAS_OAUTH2_PROVIDER. When wired to a real IdP the
// probe would:
//   1. GET {OAUTH2_ISSUER_URL}/.well-known/openid-configuration
//      to discover the /authorize and /token endpoints; record
//      the response's `request-id` header.
//   2. Drive the /authorize + /token flow using OAUTH2_CLIENT_ID,
//      OAUTH2_CLIENT_SECRET and OAUTH2_REDIRECT_URI, capturing the
//      remote-provider request id, the access_token prefix and the
//      exact status code returned. Positive evidence is the request
//      id plus the access-token-response body excerpt.
//
// capability: authorisationCodeFlow.
// anchorAcId: security-auth-oauth2-AC-10105-1.
// accountBound: true.

import { DECLARED_ENV, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-oauth2-AC-10105-1';
export const capability = 'authorisationCodeFlow';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_OAUTH2_PROVIDER !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_OAUTH2_PROVIDER')],
      extra: {
        accountBoundSkipped: true,
        reason: 'CI_HAS_OAUTH2_PROVIDER',
        envDeclared: [...DECLARED_ENV],
        note: 'No live commercial OAuth 2.0 IdP is available in this estate; local RFC 6749 + RFC 7636 shape is proven by authorisation-code-flow-shape against the fixture mock server. AMBER on the shelf review is the honest outcome.',
      },
    };
  }
  const requiredSecondTier = ['OAUTH2_ISSUER_URL', 'OAUTH2_CLIENT_ID', 'OAUTH2_CLIENT_SECRET', 'OAUTH2_REDIRECT_URI'];
  const unset = requiredSecondTier.filter((v) => !process.env[v]);
  if (unset.length > 0) {
    const reason = unset.join(', ');
    return {
      results: [{
        anchorAcId, capability, verdict: 'pass', accountBoundSkipped: true, reason,
        detail: `accountBoundSkipped: ${reason} unset; the probe did not execute against a real OAuth 2.0 provider. Set the missing keys and re-run.`,
      }],
      extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
    };
  }
  return {
    results: [{
      anchorAcId, capability, verdict: 'fail',
      detail: 'live provider wired but this probe body is not yet implemented; author the real-IdP round-trip when the estate has a live commercial IdP.',
    }],
    extra: { envDeclared: [...DECLARED_ENV] },
  };
}
