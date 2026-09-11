// application-empty-error-states probe: error-boundary state
// (AC-22108-1). AC-22108-1 explicitly permits the sample-app
// /probe/error-boundary?crash=1 route as the observation trigger; the
// probe drives that route and observes the active crash state
// (role="alert" region, [data-recovery="retry"] control, class-level
// error label). The prior standby-absence row was removed under the
// positive-anchor cleanup (positive-anchor on absence is void).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22108-1';
export const accountBound = false;

function stripHtml(html) {
  return String(html)
    .replace(/<script[^]*?<\/script>/gi, ' ')
    .replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stackFramePresent(text) {
  // Backtrace frame ("at fn (file:line:col)"), a source path ending in
  // a JS-family extension, an env-var key shape, or a node_modules
  // segment. Correlation-id tokens are not stack frames.
  if (/\bat\s+[A-Za-z_$][A-Za-z0-9_$.]*\s*\([^)]+:\d+:\d+\)/.test(text)) return true;
  if (/(^|\s)(\.\.?\/|\/)[A-Za-z0-9_./-]+\.(js|mjs|cjs|ts|tsx|jsx)\b/i.test(text)) return true;
  if (/process\.env\.[A-Z_][A-Z0-9_]*/.test(text)) return true;
  if (/\bnode_modules\//.test(text)) return true;
  return false;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const crash = await fixtureFetch(fixture.url, '/probe/error-boundary?crash=1');
    const surfaceText = stripHtml(crash.body);
    const alertRegion = /data-surface="error-boundary"[^>]*role="alert"/.test(crash.body);
    const retryControl = /data-recovery="retry"/.test(crash.body);
    const errorClass = /data-error-class="render-failure"/.test(crash.body);
    const plainSummary = /Widget failed to render/.test(surfaceText);
    const noStack = !stackFramePresent(surfaceText);
    const crashPass = crash.status === 200 && !!crash.requestId && alertRegion && retryControl && errorClass && plainSummary && noStack;
    results.push({
      anchorAcId,
      conformanceOnly: true,
      limitation: 'application-empty-error-states-AC-22108-1: this row observes the error-boundary state renders role=alert, retry control, class-level error label, plain summary and no stack-frame pattern hit, a partial observation of AC-22108-1; the AC also requires the plain summary contract to hold across varied crash payloads the origin might have leaked (framework internal frames, arbitrary env keys) - varied-input plain-summary derivation against a shipped origin is not observed by this Node HTTP probe against a fixed fixture',
      verdict: crashPass ? 'warn' : 'fail',
      detail: crashPass
        ? `Given a synthetic client-side render exception thrown via the sample-app /probe/error-boundary?crash=1 route: observed role="alert" region, [data-recovery="retry"] control, data-error-class="render-failure" label and plain summary "Widget failed to render" on the rendered surface; no stack-frame pattern hit; x-fixture-request-id=${crash.requestId}`
        : `Given a synthetic client-side render exception thrown via /probe/error-boundary?crash=1 (evidence gap): status=${crash.status} rid=${crash.requestId} alert=${alertRegion} retry=${retryControl} errorClass=${errorClass} summary=${plainSummary} noStack=${noStack}`,
      evidence: {
        requestId: crash.requestId,
        responseStatus: crash.status,
        bodyExcerpt: excerpt(surfaceText),
        derived: { alertRegion, retryControl, errorClass, plainSummary, noStack },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
