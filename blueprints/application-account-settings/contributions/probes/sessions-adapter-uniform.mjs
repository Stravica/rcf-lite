// application-account-settings probe: sessions surface render
// contract is identical regardless of the applied auth provider
// (AC-25106-1). The probe drives the same fixture with two
// provider-labelled caps configurations (a placeholder for "clerk"
// vs "keycloak" flavours; the fixture normalises to the same
// sessionInventory surface) and asserts the derived DOM shape is
// byte-identical after normalisation.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25106-1';
export const accountBound = false;

function normalise(body) {
  const m = body.match(/<div data-surface="sessions"[^]*?<\/table>/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

export default async function runProbe() {
  const results = [];
  const capsA = 'principalDirectory,sessionInventory';
  const capsB = 'principalDirectory,sessionInventory,credentialSelfService';
  const a = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: capsA } });
  const b = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: capsB } });
  try {
    const ra = await fixtureFetch(a.url, '/account/sessions');
    const rb = await fixtureFetch(b.url, '/account/sessions');
    const normA = normalise(ra.body);
    const normB = normalise(rb.body);
    const identical = normA.length > 0 && normA === normB;
    const pass = ra.status === 200 && rb.status === 200
      && !!ra.requestId && !!rb.requestId && identical;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Sessions surface DOM is byte-identical across two caps configurations (${capsA}) and (${capsB}); derived normalised subtree length=${normA.length}; x-fixture-request-id A=${ra.requestId} B=${rb.requestId}`
        : `provider-uniform gap: statuses=${ra.status},${rb.status} rids=${ra.requestId},${rb.requestId} identical=${identical} lens=${normA.length},${normB.length}`,
      evidence: {
        requestId: ra.requestId,
        responseStatus: ra.status,
        bodyExcerpt: excerpt(normA),
        derived: { normLengthA: normA.length, normLengthB: normB.length, identical },
      },
    });
  } finally {
    await a.kill();
    await b.kill();
  }
  return { results };
}
