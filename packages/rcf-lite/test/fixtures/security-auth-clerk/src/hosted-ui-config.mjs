// Hosted-identity-UI configuration surface for the security-auth-
// clerk fixture. A blueprint applying agent supplies a config object
// with signIn/signUp URL and the fallback redirect; the adapter
// refuses a config that omits either or that points at a non-HTTPS
// origin (Clerk hosted-UI URLs are https-only per Clerk docs
// https://clerk.com/docs/customization/account-portal, verifiedOn
// 2026-09-11).

export function validateHostedUiConfig(config) {
  const missing = [];
  if (!config || !config.signInUrl) missing.push('signInUrl');
  if (!config || !config.signUpUrl) missing.push('signUpUrl');
  if (!config || !config.afterSignInRedirect) missing.push('afterSignInRedirect');
  if (missing.length > 0) return { ok: false, error: `missing keys: ${missing.join(',')}` };
  for (const key of ['signInUrl', 'signUpUrl', 'afterSignInRedirect']) {
    const url = config[key];
    if (!/^https:\/\//.test(url)) {
      return { ok: false, error: `${key} must be https; observed ${url}` };
    }
  }
  return { ok: true, urls: {
    signInUrl: config.signInUrl,
    signUpUrl: config.signUpUrl,
    afterSignInRedirect: config.afterSignInRedirect,
  } };
}
