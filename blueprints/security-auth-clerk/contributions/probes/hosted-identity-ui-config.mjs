// Hosted-identity-UI configuration probe for security-auth-clerk.
// Exercises the applying-agent-supplied hosted UI config surface:
// sign-in, sign-up and after-sign-in redirect must be present and
// https, matching the Clerk hosted-UI contract (Clerk hosted-UI
// URLs are https-only; https://clerk.com/docs/customization/account-portal
// verifiedOn 2026-09-11).
//
// capability: hostedIdentityUi.
// anchorAcId: security-auth-clerk-AC-9104-1.
// accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk', 'src');

export const anchorAcId = 'security-auth-clerk-AC-9104-1';
export const capability = 'hostedIdentityUi';
export const accountBound = false;

export default async function runProbe() {
  const { validateHostedUiConfig } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'hosted-ui-config.mjs')).href);

  const results = [];
  const good = validateHostedUiConfig({
    signInUrl: 'https://accounts.example.com/sign-in',
    signUpUrl: 'https://accounts.example.com/sign-up',
    afterSignInRedirect: 'https://app.example.com/',
  });
  results.push({
    anchorAcId,
    capability,
    verdict: good.ok ? 'pass' : 'fail',
    detail: `hosted-ui happy path: ok=${good.ok} urls=${JSON.stringify(good.urls || good.error)}`,
    evidence: { input: 'all three https urls', validatorReturn: good },
  });

  const missing = validateHostedUiConfig({ signInUrl: 'https://x/y' });
  results.push({
    anchorAcId: 'security-auth-clerk-AC-9104-2',
    capability,
    verdict: !missing.ok && /missing keys/.test(missing.error) ? 'pass' : 'fail',
    detail: `hosted-ui missing-keys refusal: ok=${missing.ok} error=${JSON.stringify(missing.error)}`,
    evidence: { validatorReturn: missing },
  });

  const nonHttps = validateHostedUiConfig({
    signInUrl: 'http://accounts.example.com/sign-in',
    signUpUrl: 'https://accounts.example.com/sign-up',
    afterSignInRedirect: 'https://app.example.com/',
  });
  results.push({
    anchorAcId: 'security-auth-clerk-AC-9104-3',
    capability,
    verdict: !nonHttps.ok && /must be https/.test(nonHttps.error) ? 'pass' : 'fail',
    detail: `hosted-ui non-https refusal: ok=${nonHttps.ok} error=${JSON.stringify(nonHttps.error)}`,
    evidence: { validatorReturn: nonHttps },
  });

  return { results, extra: {} };
}
