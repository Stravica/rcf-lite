// Probe: TURNSTILE_SECRET is read only via env-shaped identifiers; no non-test-key secret literal in the pack fixture source.
// anchorAcId: AC-35107-1. accountBound: false.
//
// The pack fixture pins the Cloudflare public test keys as environment defaults so the pack does not need real Turnstile credentials
// to run (spec section 3.2). The test keys are documented at https://developers.cloudflare.com/turnstile/troubleshooting/testing/
// and are public per Cloudflare; the scan allows those literals only and refuses any other secret-shaped literal.

export const anchorAcId = 'AC-35107-1';
export const accountBound = false;

export default async function runProbe() {
  const { FIXTURE_DIR, TEST_SECRETS, collectFiles, readFileText } = await import('./probe-utils.mjs');
  const results = [];

  const files = await collectFiles(FIXTURE_DIR, ['.js', '.mjs', '.cjs']);
  // 1. Every TURNSTILE_SECRET reference must be an env-shaped read (process.env.TURNSTILE_SECRET).
  const envReadPattern = /process\.env\.TURNSTILE_(?:SECRET|FAIL_SECRET|SITEKEY|INVISIBLE_SITEKEY|INVISIBLE_BLOCK_SITEKEY|BLOCK_SITEKEY|FORCED_SITEKEY|WIDGET_MODE|GUARDED_SURFACES)\b/;
  const bareRefPattern = /\bTURNSTILE_SECRET\b/g;

  let envReadCount = 0;
  let bareRefCount = 0;
  const bareRefLocations = [];

  for (const file of files) {
    const src = await readFileText(file);
    const bare = [...src.matchAll(bareRefPattern)];
    for (const m of bare) {
      const window = src.slice(Math.max(0, m.index - 40), m.index + m[0].length);
      if (window.match(envReadPattern)) envReadCount++;
      else {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        const lineEnd = src.indexOf('\n', m.index);
        const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
        const beforeCommented = line.slice(0, m.index - lineStart).includes('//');
        if (beforeCommented || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        bareRefCount++;
        bareRefLocations.push({ file: file.replace(FIXTURE_DIR + '/', ''), line: src.slice(0, m.index).split('\n').length });
      }
    }
  }

  results.push({
    anchorAcId: 'AC-35107-1',
    verdict: (envReadCount >= 1 && bareRefCount === 0) ? 'pass' : 'fail',
    detail: (envReadCount >= 1 && bareRefCount === 0)
      ? `TURNSTILE_SECRET is read only via env-shaped identifiers; envReads=${envReadCount}, bareOutsideEnvFacade=0, filesScanned=${files.length}`
      : `TURNSTILE_SECRET bare references outside process.env facade: ${JSON.stringify(bareRefLocations)}`,
  });

  // 2. No non-pinned-test secret literal appears in source. Cloudflare public test keys (documented on
  // https://developers.cloudflare.com/turnstile/troubleshooting/testing/) are the ONLY secret-shaped
  // literals allowed as env defaults per spec section 3.2.
  const allowedTestSecrets = new Set(Object.values(TEST_SECRETS));
  // A secret-shaped literal is a 30-char-or-longer alphanumeric string sitting inside single or double quotes.
  const secretLiteralPattern = /["']([A-Za-z0-9_-]{30,})["']/g;
  const leaks = [];
  for (const file of files) {
    const src = await readFileText(file);
    let m;
    while ((m = secretLiteralPattern.exec(src)) !== null) {
      const lit = m[1];
      if (allowedTestSecrets.has(lit)) continue;
      // Ignore obvious non-secrets: URLs (contain slashes), function names.
      if (lit.startsWith('http') || lit.includes('/')) continue;
      leaks.push({ file: file.replace(FIXTURE_DIR + '/', ''), fragment: lit.slice(0, 8) + '...' });
    }
  }
  results.push({
    anchorAcId: 'AC-35107-1',
    verdict: leaks.length === 0 ? 'pass' : 'fail',
    detail: leaks.length === 0
      ? `only Cloudflare public test secrets appear as env defaults (allowed per Cloudflare testing docs); no other secret-shaped literal found in ${files.length} files`
      : `unexpected secret-shaped literal in fixture source: ${JSON.stringify(leaks)}`,
  });

  return { results, extra: { filesScanned: files.length, allowedTestSecretCount: allowedTestSecrets.size } };
}
