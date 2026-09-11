// application-account-settings probe: theme surface renders as a
// radiogroup with three options when application-spa is applied
// (AC-25108-1). Varies input on application-spa presence and on the
// elicited theme-persistence value.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25108-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const withSpa = await startFixture({ env: { ACCOUNT_SETTINGS_APPS: 'application-spa' } });
  try {
    for (const persist of ['spa-local-storage', 'server-scoped', 'none']) {
      const r = await fixtureFetch(withSpa.url, `/account/theme?theme-persistence=${encodeURIComponent(persist)}`);
      const radiogroup = /<div data-surface="theme"[^>]*role="radiogroup"[^>]*aria-label="Theme"[^>]*data-persist="([^"]+)"/.exec(r.body);
      const derivedPersist = radiogroup ? radiogroup[1] : null;
      const options = [...r.body.matchAll(/<input type="radio" name="theme" value="([^"]+)"[^>]*>/g)].map((m) => m[1]);
      const optSet = new Set(options);
      const hasAll = ['light', 'dark', 'system'].every((v) => optSet.has(v));
      const pass = r.status === 200 && !!r.requestId
        && !!radiogroup && derivedPersist === persist && options.length === 3 && hasAll;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET /account/theme?theme-persistence=${persist}: derived radiogroup with data-persist="${derivedPersist}" (reflects varied elicit); three radio options ${JSON.stringify(options)} exactly light/dark/system; x-fixture-request-id=${r.requestId}`
          : `theme evidence gap: status=${r.status} rid=${r.requestId} radiogroup=${!!radiogroup} derivedPersist=${derivedPersist} options=${JSON.stringify(options)}`,
        evidence: {
          requestId: r.requestId,
          responseStatus: r.status,
          bodyExcerpt: excerpt((r.body.match(/<div data-surface="theme"[^]{0,260}/) || [''])[0]),
          derived: { persistInput: persist, derivedPersist, options },
        },
      });
    }
  } finally {
    await withSpa.kill();
  }

  const noSpa = await startFixture({ env: { ACCOUNT_SETTINGS_APPS: '' } });
  try {
    const r = await fixtureFetch(noSpa.url, '/account/theme');
    const surface = /<div data-surface="theme"/.test(r.body);
    const pass = r.status === 200 && !!r.requestId && !surface;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /account/theme without application-spa applied: derived data-surface="theme" absent (AC-25108-1 gates the surface on the applied blueprint); x-fixture-request-id=${r.requestId}`
        : `no-spa gap: status=${r.status} rid=${r.requestId} surface=${surface}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt(r.body.slice(0, 240)),
        derived: { surface },
      },
    });
  } finally {
    await noSpa.kill();
  }
  return { results };
}
