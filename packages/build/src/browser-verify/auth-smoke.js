// Auth-REQ smoke checks (ui-design-gate-0.7.0-spec §9).
//
// A small pack of curl-shape checks that run at Finalise for any FBS
// binding an auth REQ. Composes with Track A's preflight rec 3
// (`uiBaseline.defaults.authFlow.htmlLoginPageRequired`); when the
// baseline says API-only, the pack is skipped.
//
// Directly addresses the cold-run defect where `/login` returned 404
// for the full run. Implemented as fetch-shaped checks against a
// runtime URL; the runner (injectable) is the ambient `fetch` by
// default. Callers pass `runtimeUrl` (e.g. http://127.0.0.1:3000).

/**
 * @typedef {object} AuthSmokeResult
 * @property {string} check
 * @property {number} [status]
 * @property {string} [contentType]
 * @property {'pass'|'warn'|'fail'} verdict
 * @property {string} [detail]
 */

/**
 * @typedef {object} AuthSmokeRunnerInput
 * @property {(url: string, init?: object) => Promise<{ status: number, headers: { get: (name: string) => string|null } }>} fetch
 * @property {string} runtimeUrl
 */

const HTML_CONTENT_TYPE_RE = /^text\/html\b/i;

/**
 * True when a FBS should run the auth smoke pack. Reads (in priority
 * order) the FBS's own dependsOnServices auth categories, then falls
 * back to the manifest's uiBaseline.defaults.authFlow.smokeChecksRequired.
 *
 * @param {object} fbs
 * @param {object|null} uiBaseline
 * @returns {boolean}
 */
export function shouldRunAuthSmokeChecks(fbs, uiBaseline) {
  const services = Array.isArray(fbs?.dependsOnServices) ? fbs.dependsOnServices : [];
  const authCategories = new Set(['auth', 'oauth', 'identityProvider', 'emailAuth']);
  const bindsAuth = services.some((s) => authCategories.has(String(s?.serviceCategory ?? '')));
  const baselineRequires = uiBaseline?.defaults?.authFlow?.htmlLoginPageRequired === true
    && uiBaseline?.defaults?.authFlow?.smokeChecksRequired !== false;
  return bindsAuth || baselineRequires;
}

/**
 * Run the smoke pack against `runtimeUrl`. Returns one result per check.
 *
 * @param {AuthSmokeRunnerInput} args
 * @returns {Promise<AuthSmokeResult[]>}
 */
export async function runAuthSmokeChecks({ fetch, runtimeUrl }) {
  /** @type {AuthSmokeResult[]} */
  const results = [];
  results.push(await runOne({
    check: 'GET /login', fetch,
    request: () => fetch(joinUrl(runtimeUrl, '/login')),
    accept: (status, contentType) => {
      if (status !== 200) return { verdict: 'fail', detail: `status ${status} (expected 200)` };
      if (!HTML_CONTENT_TYPE_RE.test(contentType ?? '')) return { verdict: 'fail', detail: `content-type '${contentType ?? '(missing)'}' (expected text/html)` };
      return { verdict: 'pass' };
    },
  }));
  results.push(await runOne({
    check: 'POST /logout', fetch,
    request: () => fetch(joinUrl(runtimeUrl, '/logout'), { method: 'POST', redirect: 'manual' }),
    accept: (status) => {
      if (status === 200 || status === 302 || status === 303) return { verdict: 'pass' };
      return { verdict: 'fail', detail: `status ${status} (expected 200 | 302 | 303)` };
    },
  }));
  results.push(await runOne({
    check: 'GET /login/verify?token=',
    fetch,
    request: () => fetch(joinUrl(runtimeUrl, '/login/verify?token='), { redirect: 'manual' }),
    accept: (status) => {
      if (status === 400 || status === 401 || status === 403) return { verdict: 'pass' };
      if (status === 302 || status === 303) return { verdict: 'pass' };
      if (status === 200) return { verdict: 'fail', detail: 'status 200 (empty-token accepted; regression on the empty-token vuln)' };
      return { verdict: 'fail', detail: `status ${status} (expected 400 | 401 | 403 | 302 | 303)` };
    },
  }));
  return results;
}

async function runOne({ check, request, accept }) {
  try {
    const response = await request();
    const status = response?.status;
    const contentType = response?.headers?.get ? response.headers.get('content-type') : null;
    const outcome = accept(status, contentType);
    return {
      check,
      status,
      ...(contentType ? { contentType } : {}),
      verdict: outcome.verdict,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    };
  } catch (err) {
    return { check, verdict: 'fail', detail: `request failed: ${err.message}` };
  }
}

function joinUrl(base, path) {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
}
