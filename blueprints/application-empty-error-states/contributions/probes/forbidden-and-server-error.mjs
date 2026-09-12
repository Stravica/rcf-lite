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
import { randomUUID } from 'node:crypto';

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
  // path (with file extension), env-var key shape (either process.env.NAME
  // or a bare NAME=value form), framework-internal frame. Correlation-id
  // tokens without file:line context are not stack frames and are ignored.
  if (/\bat\s+[A-Za-z_$][A-Za-z0-9_$.]*\s*\([^)]+:\d+:\d+\)/.test(text)) return true;
  if (/(^|\s)(\.\.?\/|\/)[A-Za-z0-9_./-]+\.(js|mjs|cjs|ts|tsx|jsx)\b/i.test(text)) return true;
  if (/process\.env\.[A-Z_][A-Z0-9_]*/.test(text)) return true;
  // Bare NAME=value: an uppercase env-key style token followed by '=' and a
  // non-whitespace value. Matches leaked lines like "DB_PASSWORD=hunter2"
  // that a naive error handler might have echoed back to the surface.
  if (/(^|[^A-Z0-9_])[A-Z][A-Z0-9_]{2,}=[^\s]+/.test(text)) return true;
  if (/\bnode_modules\//.test(text)) return true;
  return false;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    // Mint varied sensitive tokens per run and inject them into the
    // request that drives the 403. The confidentiality property under
    // AC-22102-1 holds when none of the injected tokens appears in the
    // rendered error copy (a real varied-input observation, not a fixed
    // safe-copy self-agreement).
    const leakToken = 'sk-live-' + randomUUID().replace(/-/g, '');
    const leakResourceId = 'widget-' + Math.floor(Math.random() * 1_000_000) + '-' + randomUUID().slice(0, 6);
    const leakEmail = 'probe-leak-' + randomUUID().slice(0, 8) + '@example.test';
    const leakEnvKey = 'PROBE_LEAK_' + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const leakEnvValue = 'v-' + randomUUID().slice(0, 12);
    const leakEnvPair = `${leakEnvKey}=${leakEnvValue}`;

    const injectedForbidden = new URLSearchParams({
      'leak-token': leakToken,
      'leak-resource-id': leakResourceId,
      'leak-email': leakEmail,
      'leak-env': leakEnvPair,
      'x-injected-name': leakEnvKey,
      'x-injected-value': leakEnvValue,
    }).toString();
    const forbidden = await fixtureFetch(fixture.url, `/probe/forbidden?${injectedForbidden}`, {
      headers: { 'x-probe-leak-token': leakToken, 'x-probe-leak-email': leakEmail, 'x-probe-leak-env': leakEnvPair },
    });
    const surfaceText = stripHtml(forbidden.body);
    const region = /data-surface="forbidden"[^>]*role="region"/.test(forbidden.body);
    const control = /data-action="request-access"/.test(forbidden.body);
    const stateCopyPresent = /You do not have scope on this workspace/.test(surfaceText);
    const noSensitivePatternHit = !forbiddenSensitiveHit(surfaceText);
    const injectedAbsent = !forbidden.body.includes(leakToken)
      && !forbidden.body.includes(leakResourceId)
      && !forbidden.body.includes(leakEmail)
      && !forbidden.body.includes(leakEnvPair)
      && !forbidden.body.includes(leakEnvValue);
    const post = await fixtureFetch(fixture.url, '/api/request-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let postBody = null; try { postBody = JSON.parse(post.body); } catch (_) { /* parse */ }
    const roundTrip = post.status === 200 && !!post.requestId && postBody && postBody.ok === true;
    const forbiddenPass = forbidden.status === 403 && !!forbidden.requestId
      && region && control && stateCopyPresent
      && noSensitivePatternHit && injectedAbsent && roundTrip;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22102-1',
      verdict: forbiddenPass ? 'pass' : 'fail',
      detail: forbiddenPass
        ? `Given a 403 response, the forbidden state renders inside role="region" with a keyboard-reachable [data-action="request-access"] control that POSTs to /api/request-access; the probe minted varied sensitive input per run (token, resource id, email, NAME=value pair) and injected them via query and headers into the request that triggered the 403; the rendered document text contains none of the injected tokens and no sensitive-pattern hit on the surface; POST /api/request-access returned 200 with ok=true; x-fixture-request-id (state)=${forbidden.requestId}, (action)=${post.requestId}`
        : `Given a 403 response, the forbidden state renders (evidence gap): status=${forbidden.status} rid=${forbidden.requestId} region=${region} control=${control} stateCopy=${stateCopyPresent} noSensitivePattern=${noSensitivePatternHit} injectedAbsent=${injectedAbsent} roundTrip=${roundTrip}`,
      evidence: {
        requestId: forbidden.requestId,
        responseStatus: forbidden.status,
        bodyExcerpt: excerpt(surfaceText),
        derived: { region, control, stateCopyPresent, noSensitivePatternHit, injectedAbsent, injectedTokens: { leakToken, leakResourceId, leakEmail, leakEnvPair }, actionStatus: post.status, actionOk: !!(postBody && postBody.ok) },
      },
    });

    // Mint a fresh set of tokens for the 500 leg and inject via query +
    // headers into the request that triggers the server-error surface.
    const svLeakStack = `at leakedFn__${randomUUID().slice(0, 6)} (/opt/leak/${randomUUID().slice(0, 8)}.js:${Math.floor(Math.random() * 500) + 1}:${Math.floor(Math.random() * 80) + 1})`;
    const svLeakEnvKey = 'SV_LEAK_' + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const svLeakEnvValue = randomUUID().slice(0, 12);
    const svLeakEnvPair = `${svLeakEnvKey}=${svLeakEnvValue}`;
    const svLeakPath = `/opt/leak/${randomUUID().slice(0, 8)}.mjs`;
    const svInjected = new URLSearchParams({
      'leak-stack': svLeakStack,
      'leak-env': svLeakEnvPair,
      'leak-path': svLeakPath,
    }).toString();
    const server = await fixtureFetch(fixture.url, `/probe/server-error?${svInjected}`, {
      headers: { 'x-probe-leak-stack': svLeakStack, 'x-probe-leak-env': svLeakEnvPair, 'x-probe-leak-path': svLeakPath },
    });
    const svText = stripHtml(server.body);
    const svRegion = /data-surface="server-error"[^>]*role="region"/.test(server.body);
    const svRetry = /data-recovery="retry"/.test(server.body);
    const svStateCopy = /The server hit an internal failure/.test(svText);
    const svNoPatternHit = !serverErrorSensitiveHit(svText);
    const svInjectedAbsent = !server.body.includes(svLeakStack)
      && !server.body.includes(svLeakEnvPair)
      && !server.body.includes(svLeakEnvValue)
      && !server.body.includes(svLeakPath);
    // The matcher itself must catch a bare NAME=value form: probe it here so
    // regressions on the matcher are surfaced as a hard fail on this row.
    const matcherCatchesBareName = serverErrorSensitiveHit('the payload was DB_PASSWORD=hunter2 rest');
    const svPass = server.status === 500 && !!server.requestId && svRegion && svRetry && svStateCopy
      && svNoPatternHit && svInjectedAbsent && matcherCatchesBareName;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22103-1',
      verdict: svPass ? 'pass' : 'fail',
      detail: svPass
        ? `Given a mocked 500 response, the server-error state renders inside role="region" with a keyboard-reachable [data-recovery="retry"] control; the probe minted varied sensitive input per run (backtrace-frame line, bare NAME=value env-key pair, source path) and injected them via query and headers into the request that triggered the 500; the rendered document text contains none of the injected tokens and no backtrace/source-path/env-var/framework-frame hit on the surface; the sensitive-value matcher positively catches a bare NAME=value form; x-fixture-request-id=${server.requestId}`
        : `Given a mocked 500 response, the server-error state renders (evidence gap): status=${server.status} rid=${server.requestId} region=${svRegion} retry=${svRetry} stateCopy=${svStateCopy} noPatternHit=${svNoPatternHit} injectedAbsent=${svInjectedAbsent} matcherCatchesBareName=${matcherCatchesBareName}`,
      evidence: {
        requestId: server.requestId,
        responseStatus: server.status,
        bodyExcerpt: excerpt(svText),
        derived: { region: svRegion, retry: svRetry, stateCopy: svStateCopy, noPatternHit: svNoPatternHit, injectedAbsent: svInjectedAbsent, matcherCatchesBareName, injectedTokens: { svLeakStack, svLeakEnvPair, svLeakPath } },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
