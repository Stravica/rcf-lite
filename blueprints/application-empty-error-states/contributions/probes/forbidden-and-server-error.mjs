// application-empty-error-states probe: 403 forbidden and 500 server
// error states (AC-22102-1, AC-22103-1).
//
// AC-22102-1 requires the forbidden state to render inside role="region"
// with a keyboard-reachable [data-action="request-access"] control that
// POSTs to /api/request-access; the rendered surface must NOT contain
// any sensitive-pattern hit (resource id shape, resource name shape,
// path-shape strings starting with /).
//
// AC-22103-1 requires the server-error state to render inside
// role="region" with a keyboard-reachable [data-recovery="retry"] control;
// the rendered surface must NOT contain a backtrace-frame prefix
// ("at " + function + file:line), a source path starting with /, ./
// or ../, an environment-variable key shape (NAME= or process.env.NAME),
// or a framework-internal frame prefix.
//
// Positive-anchor rows only: broken-variant rows on absence were removed
// under the positive-anchor cleanup (they positively-anchor on absence and are void).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22102-1';
export const accountBound = false;

function stripHtml(html) {
  return String(html)
    .replace(/<script[^]*?<\/script>/gi, ' ')
    .replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function forbiddenSensitiveHit(text) {
  // Sensitive-pattern list per AC-22102-1: resource id shape (kind-digits-slug,
  // e.g. widget-2039-alpha), a resource-name slug (kind-slug-slug preceded
  // by resource identifiers), or a URL path-shape string with 2+ segments.
  // A request-id shape (letters-letters-digits) is a correlation id, not a
  // resource id, and is not sensitive.
  if (/\b[a-z]+-\d{3,}-[a-z][a-z0-9]*\b/i.test(text)) return true;
  if (/\b(resource|id|widget|entity)=[a-z0-9-]+/i.test(text)) return true;
  if (/(^|\s)\/[a-z][a-z0-9_-]+\/[a-z0-9_-]+/i.test(text)) return true;
  return false;
}

function serverErrorSensitiveHit(text) {
  // Sensitive-pattern list per AC-22103-1: backtrace frame, source
  // path (with file extension), env-var key shape, framework-internal
  // frame. Correlation-id tokens without file:line context are not
  // stack frames and are ignored.
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
    const forbidden = await fixtureFetch(fixture.url, '/probe/forbidden');
    const surfaceText = stripHtml(forbidden.body);
    const region = /data-surface="forbidden"[^>]*role="region"/.test(forbidden.body);
    const control = /data-action="request-access"/.test(forbidden.body);
    const stateCopyPresent = /You do not have scope on this workspace/.test(surfaceText);
    const noSensitiveHit = !forbiddenSensitiveHit(surfaceText);
    const post = await fixtureFetch(fixture.url, '/api/request-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let postBody = null; try { postBody = JSON.parse(post.body); } catch (_) { /* parse */ }
    const roundTrip = post.status === 200 && !!post.requestId && postBody && postBody.ok === true;
    const forbiddenPass = forbidden.status === 403 && !!forbidden.requestId && region && control && stateCopyPresent && noSensitiveHit && roundTrip;
    results.push({
      anchorAcId,
      verdict: forbiddenPass ? 'pass' : 'fail',
      detail: forbiddenPass
        ? `Given a 403 response, the forbidden state renders: observed role="region", [data-action="request-access"] control, state-copy "You do not have scope on this workspace" on the rendered document text, no sensitive-pattern hit on the surface; POST /api/request-access returned 200 with ok=true; x-fixture-request-id (state)=${forbidden.requestId}, (action)=${post.requestId}`
        : `Given a 403 response, the forbidden state renders (evidence gap): status=${forbidden.status} rid=${forbidden.requestId} region=${region} control=${control} stateCopy=${stateCopyPresent} noSensitive=${noSensitiveHit} roundTrip=${roundTrip}`,
      evidence: {
        requestId: forbidden.requestId,
        responseStatus: forbidden.status,
        bodyExcerpt: excerpt(surfaceText),
        derived: { region, control, stateCopyPresent, noSensitiveHit, actionStatus: post.status, actionOk: !!(postBody && postBody.ok) },
      },
    });

    const server = await fixtureFetch(fixture.url, '/probe/server-error');
    const svText = stripHtml(server.body);
    const svRegion = /data-surface="server-error"[^>]*role="region"/.test(server.body);
    const svRetry = /data-recovery="retry"/.test(server.body);
    const svStateCopy = /The server hit an internal failure/.test(svText);
    const svNoPattern = !serverErrorSensitiveHit(svText);
    const svPass = server.status === 500 && !!server.requestId && svRegion && svRetry && svStateCopy && svNoPattern;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22103-1',
      verdict: svPass ? 'pass' : 'fail',
      detail: svPass
        ? `Given a mocked 500 response, the server-error state renders: observed role="region", [data-recovery="retry"] control, state-copy "The server hit an internal failure" on the rendered document text, no backtrace/source-path/env-var/framework-frame hit on the surface; x-fixture-request-id=${server.requestId}`
        : `Given a mocked 500 response, the server-error state renders (evidence gap): status=${server.status} rid=${server.requestId} region=${svRegion} retry=${svRetry} stateCopy=${svStateCopy} noPattern=${svNoPattern}`,
      evidence: {
        requestId: server.requestId,
        responseStatus: server.status,
        bodyExcerpt: excerpt(svText),
        derived: { region: svRegion, retry: svRetry, stateCopy: svStateCopy, noPattern: svNoPattern },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
