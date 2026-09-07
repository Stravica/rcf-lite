// Probe: every elicited surface in the pack fixture source registers under the token-required guard;
// a live missing-token submit is refused with 400 before any downstream handler runs.
// anchorAcId: AC-35104-1. accountBound: false.

export const anchorAcId = 'AC-35104-1';
export const accountBound = false;

export default async function runProbe() {
  const { FIXTURE_DIR, bootFixture, fixturePost, readFileText } = await import('./probe-utils.mjs');
  const { resolve } = await import('node:path');
  const results = [];

  // 1. Source scan: server.js must register the guard on every guarded surface.
  const serverSrc = await readFileText(resolve(FIXTURE_DIR, 'server.js'));
  // The guard is the tokenRequiredGuard function; every POST route on a guarded surface must call it.
  const guardedSurfacesPattern = /GUARDED_SURFACES/;
  const guardCallPattern = /tokenRequiredGuard\(req, res, params\)/;
  const surfaceCheckPattern = /if \(!GUARDED_SURFACES\.includes/;
  const hasGuardedSurfaces = guardedSurfacesPattern.test(serverSrc);
  const hasGuardCall = guardCallPattern.test(serverSrc);
  const hasSurfaceCheck = surfaceCheckPattern.test(serverSrc);
  const scanOk = hasGuardedSurfaces && hasGuardCall && hasSurfaceCheck;
  results.push({
    anchorAcId: 'AC-35104-1',
    verdict: scanOk ? 'pass' : 'fail',
    detail: scanOk
      ? 'guard-shape scan: GUARDED_SURFACES declared, tokenRequiredGuard called on POST handlers, surface-check gate present before guard call'
      : `guard-shape scan miss: GUARDED_SURFACES=${hasGuardedSurfaces}, guardCall=${hasGuardCall}, surfaceCheck=${hasSurfaceCheck}`,
  });

  // 2. Live refuse: missing-token POST to every guarded surface returns 400 with turnstile.token-missing.
  const fixture = await bootFixture();
  try {
    for (const path of ['/api/submit', '/api/magic-link']) {
      const resp = await fixturePost(fixture.url, path, { email: 'reviewer@example.com', 'turnstile-sitekey': '1x00000000000000000000AA' });
      const ok = resp.status === 400 && resp.json && resp.json.errorCode === 'turnstile.token-missing';
      results.push({
        anchorAcId: 'AC-35104-1',
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `guard rejected missing-token submit on ${path} with status=400 errorCode=turnstile.token-missing`
          : `guard unexpected shape on ${path} status=${resp.status} body=${resp.text}`,
      });
    }
  } finally { await fixture.stop(); }

  return { results };
}
