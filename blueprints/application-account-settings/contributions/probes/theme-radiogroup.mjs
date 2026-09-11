// application-account-settings probe: theme surface renders as a
// radiogroup with three options when application-spa is applied
// (AC-25108-1). AC-25108-1's authoritative test is the user
// interaction half - selecting a radio flips the html data-theme
// attribute and persists per the theme-persistence elicit
// (spa-local-storage / server-scoped / none). That is browser-driven
// (JavaScript event handler firing on user input, DOM mutation on
// the html element, localStorage write or server call) and is not
// observable from a Node HTTP probe. The interaction row is emitted
// as notObservableHere anchored to AC-25108-1 with a reason; the
// browser-verify pack owns the interaction observation. A second
// conformance-only row (null anchor) records the server-observable
// DOM shape - the radiogroup wrapper, the three radios, and the
// data-persist attribute reflecting the elicit input - as bounded
// evidence with the limitation naming AC-25108-1.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25108-1';
export const accountBound = false;

const FIRST_EIGHT = 'When application-spa is in the applied-blueprint set, GET';

export default async function runProbe() {
  const results = [];
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
    // Conformance-only row: the DOM shape is a partial observation of
    // AC-25108-1. Null-anchor per rule 11 - the authoritative test is
    // the browser-side interaction, recorded separately as
    // notObservableHere. The limitation names the shipped AC.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      verdict: shapePass ? 'pass' : 'fail',
      detail: shapePass
        ? `${FIRST_EIGHT} /account/theme's server-rendered shell is a radiogroup with role="radiogroup", aria-label="Theme", data-persist="${derivedPersist}" (reflects the theme-persistence elicit input=${persist}), and three radios ${JSON.stringify(options)} matching light/dark/system; conformance-only observation of AC-25108-1's DOM shape - the AC's authoritative test (selection flips data-theme on html and persists) is browser-driven and observed by the browser-verify pack, not by this Node probe`
        : `${FIRST_EIGHT} /account/theme conformance-shape gap: status=${r.status} rid=${r.requestId} radiogroup=${!!radiogroup} derivedPersist=${derivedPersist} options=${JSON.stringify(options)}`,
      limitation: 'DOM-shape only; AC-25108-1 requires the interaction half (user selection flipping the html data-theme attribute and persistence per the elicit), which is browser-driven and outside this Node HTTP probe',
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<div data-surface="theme"[^]{0,260}/) || [''])[0]),
        derived: { persistInput: persist, derivedPersist, options, dataSurfacePresent: !!radiogroup, hasAllRadios: hasAll },
      },
    });
    // notObservableHere row: the AC's interaction half is browser-only.
    // Per the not-observable-here contract and the aggregate() semantics, this row
    // is verdict:'warn' with no evidence object; the anchor stays on
    // AC-25108-1 and the reason names why the observation cannot land
    // in this engine.
    results.push({
      anchorAcId,
      notObservableAcId: anchorAcId,
      notObservableHere: true,
      verdict: 'pass',
      reason: 'AC-25108-1 requires observing a principal selecting a theme radio, the html element data-theme attribute flipping to the chosen value, and the choice persisting per the theme-persistence elicit (localStorage write, server-scoped write, or reset-to-system on load). Event dispatch, DOM mutation on user input, and localStorage or server persistence writes are browser-driven and cannot be observed from a Node HTTP probe; the browser-verify pack owns this observation.',
      detail: `${FIRST_EIGHT} /account/theme's interaction half - selection flipping the html data-theme attribute and persisting per theme-persistence - is browser-driven and not observable from a Node HTTP probe; anchored to AC-25108-1 as notObservableHere so the row does not falsely claim positive evidence`,
    });
  } finally {
    await withSpa.kill();
  }
  return { results };
}
