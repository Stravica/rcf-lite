// Hosted-identity-UI configuration probe for security-auth-clerk.
// Conformance-only. Every row de-claims its former REQ-005 anchor
// per _closure3.md (section 1): hosted URL validation is not
// REQ-005's signInStrategy/hosted-component contract. The rows keep
// their observations of the fixture URL validator; the integration
// harness (w-2026-09-11-dave-015) is the surface where the AC-level
// property becomes observable.
//
// capability: hostedIdentityUi. engine: fixture. accountBound: false.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deClaim } from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk', 'src');

export const anchorAcId = null;
export const capability = 'hostedIdentityUi';
export const accountBound = false;

const LIM = 'security-auth-clerk-AC-9101-1: probe validates hosted-UI URL shape only; the AC states the project route mounts the Clerk hosted sign-in surface, which needs a browser-driven runner (integration harness w-2026-09-11-dave-015).';

export default async function runProbe() {
  const { validateHostedUiConfig } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'hosted-ui-config.mjs')).href);
  const results = [];

  const good = validateHostedUiConfig({
    signInUrl: 'https://accounts.example.com/sign-in',
    signUpUrl: 'https://accounts.example.com/sign-up',
    afterSignInRedirect: 'https://app.example.com/',
  });
  results.push(deClaim({
    capability,
    verdict: good.ok ? 'pass' : 'fail',
    detail: `hosted-ui happy path: ok=${good.ok} urls=${JSON.stringify(good.urls || good.error)}`,
    evidence: { input: 'all three https urls', validatorReturn: good },
  }, { ac: 'security-auth-clerk-AC-9101-1', limitation: LIM }));

  const missing = validateHostedUiConfig({ signInUrl: 'https://x/y' });
  results.push(deClaim({
    capability,
    verdict: !missing.ok && /missing keys/.test(missing.error) ? 'pass' : 'fail',
    detail: `hosted-ui missing-keys refusal: ok=${missing.ok} error=${JSON.stringify(missing.error)}`,
    evidence: { validatorReturn: missing },
  }, { ac: 'security-auth-clerk-AC-9101-1', limitation: LIM }));

  const nonHttps = validateHostedUiConfig({
    signInUrl: 'http://accounts.example.com/sign-in',
    signUpUrl: 'https://accounts.example.com/sign-up',
    afterSignInRedirect: 'https://app.example.com/',
  });
  results.push(deClaim({
    capability,
    verdict: !nonHttps.ok && /must be https/.test(nonHttps.error) ? 'pass' : 'fail',
    detail: `hosted-ui non-https refusal: ok=${nonHttps.ok} error=${JSON.stringify(nonHttps.error)}`,
    evidence: { validatorReturn: nonHttps },
  }, { ac: 'security-auth-clerk-AC-9101-1', limitation: LIM }));

  return { results, extra: {} };
}
