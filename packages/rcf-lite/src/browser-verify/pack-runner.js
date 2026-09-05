// Pack pass runner (visual round T-0, US-1701 AC-1701-4 / 6). CN-108.
//
// Invokes every applicable loaded pack against a FBS and folds the
// results into a `probePacks[]` array on the browserVerification
// record. Applicability is enforced by the pack's own `appliesTo`
// predicate: a false return records `applicable: false` and no
// check runs. `preChecks[]` (if any) run first; a failing pre-check
// causes browser checks that name it under `dependsOn` to record
// `skipped` with detail `skipped-by-pre-check:<preCheckId>`.
//
// The runner is browser-driver-agnostic: the caller injects a
// `browser` seam (the same shape a pack's `run` expects on its `browser`
// argument) plus `fetch`, `runtimeUrl` and the route/theme cursor.

/**
 * Run applicable packs for one FBS.
 *
 * @param {object} args
 * @param {Array<import('./pack-loader.js').LoadedPack>} args.packs
 * @param {object} args.fbs
 * @param {object|null} args.uiBaseline
 * @param {object|null} args.manifest
 * @param {object|null} args.browser        injected browser (or null in unit tests)
 * @param {(url: string, init?: object) => Promise<any>|null} args.fetch
 * @param {string} args.runtimeUrl
 * @param {Array<object>} args.routes       FBS routes (nav model)
 * @param {Array<'light'|'dark'>} args.themes
 * @param {string} [args.packNameFilter]    when set, only packs whose packName === filter are considered
 * @param {(pack: import('./pack-loader.js').LoadedPack) => object} [args.buildContext]  optional context override for unit tests
 * @returns {Promise<{ probePacks: Array<object>, packHighestSeverityFail: 'block'|'warn'|null }>}
 */
export async function runProbePacksForFbs({
  packs,
  fbs,
  uiBaseline,
  manifest,
  projectRoot = null,
  browser,
  fetch,
  runtimeUrl,
  routes,
  themes,
  packNameFilter,
  buildContext,
}) {
  const probePacks = [];
  let highest = null;
  const chosen = Array.isArray(packs) ? packs : [];
  const primaryRoute = Array.isArray(routes) && routes.length > 0 ? routes[0] : null;
  const primaryTheme = Array.isArray(themes) && themes.length > 0 ? themes[0] : 'light';

  for (const pack of chosen) {
    if (typeof packNameFilter === 'string' && packNameFilter.length > 0 && pack.packName !== packNameFilter) {
      continue;
    }

    let applicable;
    let applicabilityDetail;
    try {
      applicable = Boolean(pack.appliesTo({ fbs, uiBaseline, manifest }));
    } catch (err) {
      applicable = false;
      applicabilityDetail = `appliesTo threw: ${err.message}`;
    }

    if (!applicable) {
      probePacks.push({
        packName: pack.packName,
        packVersion: pack.version,
        blueprintSlug: pack.blueprintSlug,
        applicable: false,
        ...(applicabilityDetail ? { detail: applicabilityDetail } : { detail: `appliesTo returned false for ${fbs?.fbsId ?? '(no fbs)'}` }),
        checks: [],
      });
      continue;
    }

    // Pre-checks first.
    const preCheckRecords = [];
    const failedPreCheckIds = new Set();
    for (const pre of pack.preChecks) {
      let verdict = 'pass';
      let detail;
      try {
        const outcome = await pre.run({ fbs, uiBaseline, manifest, runtimeUrl, fetch, browser });
        verdict = outcome?.verdict ?? 'pass';
        detail = outcome?.detail;
      } catch (err) {
        verdict = 'fail';
        detail = `pre-check threw: ${err.message}`;
      }
      preCheckRecords.push({
        id: pre.id,
        verdict,
        severity: pre.severity,
        ...(typeof detail === 'string' && detail.length > 0 ? { detail } : {}),
      });
      if (verdict === 'fail') failedPreCheckIds.add(pre.id);
      if (verdict === 'fail' && pre.severity === 'block') highest = 'block';
      else if (verdict === 'fail' && pre.severity === 'warn' && highest !== 'block') highest = 'warn';
    }

    const checkRecords = [];
    for (const check of pack.checks) {
      const deps = normaliseDependsOn(check.dependsOn);
      const failingDep = deps.find((d) => failedPreCheckIds.has(d));
      if (failingDep) {
        checkRecords.push({
          id: check.id,
          verdict: 'skipped',
          severity: check.severity,
          detail: `skipped-by-pre-check:${failingDep}`,
        });
        continue;
      }
      // Per-check applicability (visual round T-5 spec section 5.5).
      // A pack check may declare its own `appliesTo` predicate that
      // reads the applied capability set (from projectRoot) so an
      // absent capability records `applicable: false` and the
      // aggregate verdict treats the check as neither pass nor fail.
      // A check without a predicate always runs (backward compatible
      // with T-0 through T-4 packs).
      if (typeof check.appliesTo === 'function') {
        let checkApplicable;
        let checkAppliesDetail;
        try {
          checkApplicable = Boolean(await check.appliesTo({ fbs, uiBaseline, manifest, projectRoot }));
        } catch (err) {
          checkApplicable = false;
          checkAppliesDetail = `appliesTo threw: ${err.message}`;
        }
        if (!checkApplicable) {
          // Spec section 5.5 says the residual cure records
          // applicable: false at the check level. rcf-schemas 0.6.1
          // (browserVerificationProbePackCheck) closes the schema and
          // still requires a verdict enum, so the manifest write path
          // refuses a check that carries `applicable: false` alone.
          // Until the schema minor promotes an `applicable` field at
          // the check level (follow-up rcf-schemas bump), emit
          // `verdict: 'skipped'` with a detail naming the applicability
          // gate. Semantically the aggregate verdict still treats this
          // as neither pass nor fail (skipped does not raise `highest`).
          checkRecords.push({
            id: check.id,
            verdict: 'skipped',
            severity: check.severity,
            detail: checkAppliesDetail ?? 'check appliesTo returned false (required capability not applied)',
          });
          continue;
        }
      }
      const context = typeof buildContext === 'function'
        ? buildContext(pack)
        : { browser, fetch, runtimeUrl, route: primaryRoute, theme: primaryTheme, projectRoot };
      let verdict = 'pass';
      let detail;
      try {
        const outcome = await check.run(context);
        verdict = outcome?.verdict ?? 'pass';
        detail = outcome?.detail;
      } catch (err) {
        verdict = 'fail';
        detail = `check threw: ${err.message}`;
      }
      checkRecords.push({
        id: check.id,
        verdict,
        severity: check.severity,
        ...(typeof detail === 'string' && detail.length > 0 ? { detail } : {}),
      });
      if (verdict === 'fail' && check.severity === 'block') highest = 'block';
      else if (verdict === 'fail' && check.severity === 'warn' && highest !== 'block') highest = 'warn';
    }

    const record = {
      packName: pack.packName,
      packVersion: pack.version,
      blueprintSlug: pack.blueprintSlug,
      applicable: true,
      checks: checkRecords,
    };
    if (preCheckRecords.length > 0) record.preChecks = preCheckRecords;
    probePacks.push(record);
  }

  return { probePacks, packHighestSeverityFail: highest };
}

function normaliseDependsOn(dependsOn) {
  if (typeof dependsOn === 'string' && dependsOn.length > 0) return [dependsOn];
  if (Array.isArray(dependsOn)) return dependsOn.filter((d) => typeof d === 'string' && d.length > 0);
  return [];
}
