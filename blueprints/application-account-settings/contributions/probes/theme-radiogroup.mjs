// application-account-settings probe: theme surface renders as a
// radiogroup with three options when application-spa is applied, and
// the server-scoped theme-persistence variant persists a written
// theme across a subsequent GET (AC-25108-1).
//
// AC-25108-1 has TWO observable halves from a Node HTTP probe:
//   (a) the server-scoped-persistence half - when the applied
//       theme-persistence store is 'server-scoped', a POST /api/theme
//       write is reflected on the next GET /account/theme's initial
//       html data-theme attribute (server-rendered, no browser JS
//       involved); DELETE /api/theme clears the record and the next
//       GET returns to the default; and
//   (b) the DOM-shape half - the radiogroup markup, three named
//       radios and the data-persist reflection of the elicit input.
// The interaction half of AC-25108-1 - the user selecting a radio,
// the client-side script flipping the html data-theme attribute and
// writing spa-local-storage - is browser-driven and is NOT observed
// here; that row de-claims via conformanceOnly with a limitation
// naming the browser-only clause. (A dedicated browser-driven pack
// check owns the interaction observation.)

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';
import { randomUUID } from 'node:crypto';

export const anchorAcId = 'application-account-settings-AC-25108-1';
export const accountBound = false;

const FIRST_EIGHT_SPA = 'When application-spa is in the applied-blueprint set, GET';

export default async function runProbe() {
  const results = [];

  // Row 1: DOM shape (radiogroup, three radios, data-persist reflect).
  const withSpa = await startFixture({ env: { ACCOUNT_SETTINGS_APPS: 'application-spa' } });
  try {
    const persist = 'spa-local-storage';
    const r = await fixtureFetch(withSpa.url, `/account/theme?theme-persistence=${encodeURIComponent(persist)}`);
    const radiogroup = /<div data-surface="theme"[^>]*role="radiogroup"[^>]*aria-label="Theme"[^>]*data-persist="([^"]+)"/.exec(r.body);
    const derivedPersist = radiogroup ? radiogroup[1] : null;
    const options = [...r.body.matchAll(/<input type="radio" name="theme" value="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    const optSet = new Set(options);
    const hasAll = ['light', 'dark', 'system'].every((v) => optSet.has(v));
    const shapePass = r.status === 200 && !!r.requestId
      && !!radiogroup && derivedPersist === persist
      && options.length === 3 && hasAll;
    // Conformance-only: the DOM shape is a partial observation of
    // AC-25108-1. Null anchor per rule 11; the limitation names the
    // AC and the interaction clause NOT observed here.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      verdict: shapePass ? 'warn' : 'fail',
      limitation: 'application-account-settings-AC-25108-1: interaction half (user selecting a radio, client script flipping html data-theme, spa-local-storage write) is browser-driven and not observed from a Node HTTP probe',
      detail: shapePass
        ? `${FIRST_EIGHT_SPA} /account/theme's server-rendered shell is a radiogroup with role="radiogroup", aria-label="Theme", data-persist="${derivedPersist}" (reflects the theme-persistence elicit input=${persist}), and three radios ${JSON.stringify(options)} matching light/dark/system; conformance-only observation of the DOM-shape half of AC-25108-1`
        : `${FIRST_EIGHT_SPA} /account/theme conformance-shape gap: status=${r.status} rid=${r.requestId} radiogroup=${!!radiogroup} derivedPersist=${derivedPersist} options=${JSON.stringify(options)}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<div data-surface="theme"[^]{0,260}/) || [''])[0]),
        derived: { persistInput: persist, derivedPersist, options, dataSurfacePresent: !!radiogroup, hasAllRadios: hasAll },
      },
    });

    // Row 2: server-scoped persistence half of AC-25108-1. Observable
    // server-side: POST /api/theme?theme=X writes; GET reflects on
    // data-theme; DELETE clears; a further GET drops back to default.
    const principalId = 'probe-theme-' + randomUUID();
    const persistServer = 'server-scoped';
    const chosenTheme = 'dark';
    const before = await fixtureFetch(withSpa.url, `/account/theme?theme-persistence=${persistServer}&principal-id=${principalId}`);
    const beforeMatch = before.body.match(/<html[^>]*data-theme="([^"]+)"/);
    const beforeTheme = beforeMatch ? beforeMatch[1] : null;
    const write = await fixtureFetch(withSpa.url, `/api/theme?theme=${chosenTheme}&theme-persistence=${persistServer}&principal-id=${principalId}`, { method: 'POST' });
    const writeBody = (() => { try { return JSON.parse(write.body || '{}'); } catch (e) { return {}; } })();
    const after = await fixtureFetch(withSpa.url, `/account/theme?theme-persistence=${persistServer}&principal-id=${principalId}`);
    const afterHtmlTheme = (after.body.match(/<html[^>]*data-theme="([^"]+)"/) || [null, null])[1];
    const afterDataServerScoped = (after.body.match(/data-server-scoped-theme="([^"]*)"/) || [null, null])[1];
    const afterDarkChecked = /<input type="radio" name="theme" value="dark"[^>]*checked/.test(after.body);
    const clear = await fixtureFetch(withSpa.url, `/api/theme?theme-persistence=${persistServer}&principal-id=${principalId}`, { method: 'DELETE' });
    const cleared = await fixtureFetch(withSpa.url, `/account/theme?theme-persistence=${persistServer}&principal-id=${principalId}`);
    const clearedHtmlTheme = (cleared.body.match(/<html[^>]*data-theme="([^"]+)"/) || [null, null])[1];
    const clearedDataServerScoped = (cleared.body.match(/data-server-scoped-theme="([^"]*)"/) || [null, null])[1];
    const serverScopedPass = before.status === 200 && write.status === 200 && writeBody.ok === true
      && after.status === 200 && afterHtmlTheme === chosenTheme && afterDataServerScoped === chosenTheme && afterDarkChecked
      && clear.status === 200 && cleared.status === 200 && clearedHtmlTheme === 'light' && (!clearedDataServerScoped || clearedDataServerScoped.length === 0);
    results.push({
      anchorAcId,
      verdict: serverScopedPass ? 'pass' : 'fail',
      detail: serverScopedPass
        ? `When application-spa is applied with theme-persistence=server-scoped: for a fresh principalId, initial GET rendered html data-theme=${beforeTheme}; POST /api/theme?theme=${chosenTheme} wrote the record; a subsequent GET rendered html data-theme=${afterHtmlTheme} with data-server-scoped-theme=${afterDataServerScoped} and the dark radio checked; DELETE /api/theme cleared; a final GET fell back to html data-theme=${clearedHtmlTheme}. Server-scoped persistence observed across requests; x-fixture-request-id (final)=${cleared.requestId}`
        : `When application-spa is applied with theme-persistence=server-scoped (gap): before=${beforeTheme} write=${write.status}/${writeBody.ok} afterHtmlTheme=${afterHtmlTheme} afterServerScoped=${afterDataServerScoped} afterDarkChecked=${afterDarkChecked} clear=${clear.status} clearedHtmlTheme=${clearedHtmlTheme}`,
      evidence: {
        requestId: cleared.requestId,
        responseStatus: cleared.status,
        bodyExcerpt: excerpt((after.body.match(/<html[^]{0,320}/) || [''])[0]),
        derived: {
          principalId,
          beforeTheme,
          writtenTheme: chosenTheme,
          afterHtmlTheme,
          afterDataServerScoped,
          afterDarkChecked,
          clearedHtmlTheme,
        },
      },
    });

    // Row 3: interaction half is browser-only. notObservableHere
    // anchored to AC-25108-1 with verdict warn (never pass). The
    // aggregate() rule skips notObservableHere rows: the browser-only
    // half is amber-on-the-shelf, captured on this row, without
    // pulling the whole probe to warn.
    results.push({
      anchorAcId,
      notObservableAcId: anchorAcId,
      notObservableHere: true,
      verdict: 'warn',
      reason: 'AC-25108-1 requires observing a principal selecting a theme radio, the html element data-theme attribute flipping to the chosen value in response to that user input event, and (for the spa-local-storage store) the client-side localStorage write. Event dispatch, DOM mutation on user input, and localStorage writes are browser-driven and cannot be observed from a Node HTTP probe; the browser-verify pack owns this observation.',
      detail: `${FIRST_EIGHT_SPA} /account/theme's interaction half - user selection dispatching a change event, the client script flipping html data-theme on that event, and the spa-local-storage write - is browser-driven and observed by the browser-verify pack, not by this Node probe; anchored as notObservableHere for AC-25108-1 so the row does not falsely claim positive evidence`,
    });
  } finally {
    await withSpa.kill();
  }
  return { results };
}
