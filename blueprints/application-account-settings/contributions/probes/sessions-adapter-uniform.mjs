// application-account-settings probe: sessions surface render
// contract is identical regardless of which applied auth provider
// supplied sessionInventory (AC-25106-1). The probe drives the same
// fixture (sessionInventory in caps) with three provider labels
// (clerk, keycloak, oauth2) via the ?provider= query string and
// asserts the derived DOM shape is byte-identical across providers.
// The fixture emits a <meta data-observed-provider="X"> stripped by
// normalise() so the identity check exercises the render contract
// itself, not the label. If no auth blueprint declaring
// sessionInventory is in the applied capability set, no
// data-surface="sessions" subtree renders, the normalised subtree is
// empty, and the probe row fails (AC-25106-1's precondition is not
// observable in that configuration).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25106-1';
export const accountBound = false;

const FIRST_EIGHT = 'The sessions surface reads sessionInventory from the applied';

function normalise(body) {
  const m = body.match(/<div data-surface="sessions"[^]*?<\/table>/);
  if (!m) return '';
  return m[0]
    .replace(/<meta data-observed-provider="[^"]*">/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function runProbe() {
  const results = [];
  const providers = ['clerk', 'keycloak', 'oauth2'];
  const fixture = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: 'principalDirectory,sessionInventory' } });
  try {
    const observations = [];
    for (const provider of providers) {
      const r = await fixtureFetch(fixture.url, `/account/sessions?provider=${provider}`);
      const observedMatch = r.body.match(/<meta data-observed-provider="([^"]+)">/);
      const observedProvider = observedMatch ? observedMatch[1] : null;
      const norm = normalise(r.body);
      observations.push({ provider, status: r.status, requestId: r.requestId, observedProvider, norm });
    }
    const reference = observations[0];
    for (const obs of observations) {
      const adapterActive = obs.norm.length > 0;
      const identical = adapterActive && obs.norm === reference.norm;
      const pass = obs.status === 200
        && !!obs.requestId
        && obs.observedProvider === obs.provider
        && adapterActive
        && identical;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `${FIRST_EIGHT} auth provider (varied via ?provider=${obs.provider}); the render contract of AC-25105-1 is identical regardless of which auth blueprint supplied the capability; normalised sessions subtree length=${obs.norm.length} matches the ${reference.provider} reference byte-for-byte; x-fixture-request-id=${obs.requestId}`
          : `${FIRST_EIGHT} auth provider gap: provider=${obs.provider} status=${obs.status} rid=${obs.requestId} observedProvider=${obs.observedProvider} adapterActive=${adapterActive} identicalToReference=${identical} normLength=${obs.norm.length}`,
        evidence: {
          requestId: obs.requestId,
          responseStatus: obs.status,
          bodyExcerpt: excerpt(obs.norm),
          derived: {
            provider: obs.provider,
            observedProvider: obs.observedProvider,
            normLength: obs.norm.length,
            adapterActive,
            identicalToReference: identical,
            referenceProvider: reference.provider,
          },
        },
      });
    }
  } finally {
    await fixture.kill();
  }
  return { results };
}
