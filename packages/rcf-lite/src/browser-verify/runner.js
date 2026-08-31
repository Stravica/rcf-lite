// Browser-verify runner (ui-design-gate-0.7.0-spec §8.2).
//
// Two modes:
// - `operatorSession`: the operator loaded the app and cleared the
//   pages themselves; the runner takes a minimal input (the routes
//   they visited, the invariants they ticked) and writes the record.
// - `agentScreenshotCritique`: the runner drives a browser (injected)
//   over every enumerated route × theme, captures a DOM string per
//   capture, runs the versioned invariant set (§8.3), runs the auth
//   smoke pack when the FBS binds an auth REQ, aggregates the record
//   verdict per §8.5.
//
// Everything driver-shaped is injectable (browser driver, fetch,
// artefact writer) so unit tests do not need a live Playwright and CI
// can run this without a real browser. The default agent-mode driver
// is a stub that returns an empty capture and a `verdict: warn` record
// with a note pointing at "no driver wired"; production wiring lands
// via `deps.browserDriver` on the CLI handler.

import { runInvariantsForCapture, foldInvariantsForRecord, compareTopLevelStructure } from './invariants.js';
import { runAuthSmokeChecks, shouldRunAuthSmokeChecks } from './auth-smoke.js';
import { composeBrowserVerificationRecord } from './manifest-writer.js';

/**
 * @typedef {object} BrowserCapture
 * @property {string} routePath
 * @property {'light'|'dark'} themeApplied
 * @property {string} dom
 * @property {string} screenshotPath
 * @property {boolean} [authenticated]
 * @property {string} [landedPath]  the pathname of the browser's final URL after any redirect chain resolved (`new URL(page.url()).pathname`); when the driver reports it, the `authenticatedLandsOnRequestedPath` invariant fires (AC-1131-3 landed-path refusal, watchpost AC-1601-14 port)
 */

/**
 * @typedef {object} BrowserDriver
 * @property {(args: { url: string, routes: object[], themes: ('light'|'dark')[], artefactDir: string }) => Promise<BrowserCapture[]>} capture
 */

/**
 * Default agent-mode driver stub. Emits no captures; a warning surfaces
 * on the record notes. Callers wire a real Playwright driver via
 * `deps.browserDriver` on the CLI.
 *
 * @type {BrowserDriver}
 */
export const stubBrowserDriver = Object.freeze({
  async capture() { return []; },
});

/**
 * Run the agent-screenshot-critique mode against a FBS.
 *
 * @param {object} args
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {object} args.fbs
 * @param {string} args.runtimeUrl
 * @param {'deployed'|'ci'|'local-dev'} args.runtimeProfile
 * @param {BrowserDriver} args.browserDriver
 * @param {(url: string, init?: object) => Promise<any>} args.fetch
 * @param {string} args.artefactDir
 * @param {string} [args.critiqueNotes]  agent-critique rubric findings (spec §8.4)
 * @param {Date} [args.now]
 * @returns {Promise<object>}  the composed browserVerification record
 */
export async function runAgentScreenshotCritique({
  tree, fbs, runtimeUrl, runtimeProfile, browserDriver, fetch, artefactDir, critiqueNotes, now = new Date(),
}) {
  const routes = fbs?.designStage?.navModel?.routes ?? [];
  const themes = readThemesFromBaseline(tree.manifest?.uiBaseline);
  const captures = await browserDriver.capture({ url: runtimeUrl, routes, themes, artefactDir });

  const perCapture = [];
  const routesChecked = [];
  for (const cap of captures) {
    const results = runInvariantsForCapture({
      routePath: cap.routePath,
      themeApplied: cap.themeApplied,
      fbs,
      uiBaseline: tree.manifest?.uiBaseline,
      dom: cap.dom,
      authenticated: cap.authenticated,
      landedPath: cap.landedPath,
    });
    perCapture.push({ routePath: cap.routePath, themeApplied: cap.themeApplied, results });
    routesChecked.push({ path: cap.routePath, screenshotPath: cap.screenshotPath, themeApplied: cap.themeApplied });
  }

  // Structural cross-route compare for `sharedLayoutModule`.
  const structuralResult = compareTopLevelStructure(
    captures.filter((c) => c.themeApplied === 'light'),
    tree.manifest?.uiBaseline,
  );

  let invariantChecks = foldInvariantsForRecord(perCapture);
  // Replace / append the structural sharedLayoutModule result.
  invariantChecks = invariantChecks.filter((c) => c.invariant !== 'sharedLayoutModule');
  invariantChecks.push({
    invariant: structuralResult.invariant,
    verdict: structuralResult.verdict,
    ...(structuralResult.detail ? { detail: structuralResult.detail } : {}),
    severity: structuralResult.severity,
  });

  // If no captures came back at all, record a synthetic warn so the
  // operator sees the "driver was not wired" state distinctly from a
  // clean pass.
  let notes = critiqueNotes;
  if (captures.length === 0) {
    invariantChecks.push({
      invariant: 'agentDriverWired',
      verdict: 'fail',
      detail: 'browser driver returned zero captures; wire a Playwright driver via deps.browserDriver or run in --mode operatorSession',
      severity: 'warn',
    });
    notes = notes ? `${notes}\n\nDriver: no captures produced.` : 'Driver: no captures produced.';
    // Ensure schema minimums are met even without captures.
    if (routesChecked.length === 0) {
      routesChecked.push({ path: routes[0]?.path ?? '/', screenshotPath: `${artefactDir}/placeholder.png`, themeApplied: 'light' });
    }
  }

  let authSmokeChecks;
  if (shouldRunAuthSmokeChecks(fbs, tree.manifest?.uiBaseline)) {
    authSmokeChecks = await runAuthSmokeChecks({ fetch, runtimeUrl });
  }

  return composeBrowserVerificationRecord({
    manifest: tree.manifest,
    fbsId: fbs.fbsId,
    mode: 'agentScreenshotCritique',
    runtimeProfile,
    runtimeUrl,
    routesChecked,
    invariantChecks,
    authSmokeChecks,
    notes,
    now,
  });
}

/**
 * Compose the operator-session record. No captures; the operator's
 * declared list of routes plus their invariant ticks are the evidence.
 *
 * @param {object} args
 * @returns {object}
 */
export function composeOperatorSessionRecord({
  tree, fbs, runtimeUrl, runtimeProfile, declaredRoutes, invariantTicks, now = new Date(),
}) {
  const routesChecked = declaredRoutes.length > 0
    ? declaredRoutes.map((r) => ({ path: r.path, screenshotPath: `.rcf/artefacts/operator-session/${fbs.fbsId}${r.path.replace(/\W+/g, '_')}.png`, themeApplied: r.themeApplied ?? 'light' }))
    : [{ path: fbs?.designStage?.navModel?.routes?.[0]?.path ?? '/', screenshotPath: `.rcf/artefacts/operator-session/${fbs.fbsId}-declared.png`, themeApplied: 'light' }];
  const invariantChecks = invariantTicks && invariantTicks.length > 0
    ? invariantTicks.map((t) => ({ invariant: t.invariant, verdict: t.verdict ?? 'pass', ...(t.detail ? { detail: t.detail } : {}), severity: t.severity ?? 'block' }))
    : [{ invariant: 'operatorAcknowledged', verdict: 'pass', severity: 'block' }];
  return composeBrowserVerificationRecord({
    manifest: tree.manifest,
    fbsId: fbs.fbsId,
    mode: 'operatorSession',
    runtimeProfile,
    runtimeUrl,
    routesChecked,
    invariantChecks,
    now,
  });
}

function readThemesFromBaseline(baseline) {
  const mode = baseline?.defaults?.themeMode;
  if (mode === 'single-theme-declared') return ['light'];
  return ['light', 'dark'];
}
