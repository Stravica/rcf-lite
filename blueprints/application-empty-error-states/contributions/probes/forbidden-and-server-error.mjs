// application-empty-error-states probe: 403 forbidden and 500 server
// error states with sensitive-content rules (AC-22102-1, AC-22103-1).
//
// AC-22102-1 requires the forbidden state to render inside role="region"
// with a keyboard-reachable [data-action="request-access"] control
// POSTing to /api/request-access; the surface must not name any
// forbidden-resource id (leak-id break switch flips this).
//
// AC-22103-1 requires the server-error state to render inside role="region"
// with a [data-recovery="retry"] control; the surface must not carry a
// stack trace (stack-trace break switch flips this).
//
// The probe drives both states, drives their break switches, and for
// forbidden also POSTs the request-access endpoint (derived round
// trip: state fetch then action POST returns ok).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22102-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const forbidden = await fixtureFetch(fixture.url, '/probe/forbidden');
    const region = /data-surface="forbidden"[^>]*role="region"/.test(forbidden.body);
    const control = /data-action="request-access"/.test(forbidden.body);
    const noLeak = !/data-leak="resource-id"/.test(forbidden.body);
    const post = await fixtureFetch(fixture.url, '/api/request-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let postBody = null; try { postBody = JSON.parse(post.body); } catch (_) { /* parse */ }
    const roundTrip = post.status === 200 && !!post.requestId && postBody && postBody.ok === true;
    const forbiddenPass = forbidden.status === 403 && !!forbidden.requestId && region && control && noLeak && roundTrip;
    results.push({
      anchorAcId,
      verdict: forbiddenPass ? 'pass' : 'fail',
      detail: forbiddenPass
        ? `GET /probe/forbidden returned 403 with role="region", request-access control present, no leaked resource id; POST /api/request-access returned 200 with ok=true; x-fixture-request-id (state)=${forbidden.requestId}, (action)=${post.requestId}`
        : `forbidden evidence gap: state=${forbidden.status} rid=${forbidden.requestId} region=${region} control=${control} noLeak=${noLeak} roundTrip=${roundTrip}`,
      evidence: {
        requestId: forbidden.requestId,
        responseStatus: forbidden.status,
        bodyExcerpt: excerpt((forbidden.body.match(/data-surface="forbidden"[^]{0,200}/) || [''])[0]),
        derived: { region, control, noLeak, actionStatus: post.status, actionOk: !!(postBody && postBody.ok) },
      },
    });

    const brokenLeak = await fixtureFetch(fixture.url, '/probe/forbidden?break=leak-id');
    const brokenHasLeak = /data-leak="resource-id"/.test(brokenLeak.body);
    const varyForbidPass = brokenLeak.status === 403 && !!brokenLeak.requestId && brokenHasLeak;
    results.push({
      anchorAcId,
      verdict: varyForbidPass ? 'pass' : 'fail',
      detail: varyForbidPass
        ? `GET /probe/forbidden?break=leak-id returned 403 with a data-leak="resource-id" element present (the fixture confirms the AC-22102-1 leak check would refuse); x-fixture-request-id=${brokenLeak.requestId}`
        : `break=leak-id evidence gap: status=${brokenLeak.status} rid=${brokenLeak.requestId} leakPresent=${brokenHasLeak}`,
      evidence: {
        requestId: brokenLeak.requestId,
        responseStatus: brokenLeak.status,
        bodyExcerpt: excerpt((brokenLeak.body.match(/data-leak="resource-id"[^]{0,140}/) || [''])[0]),
        derived: { brokenHasLeak },
      },
    });

    const server = await fixtureFetch(fixture.url, '/probe/server-error');
    const svRegion = /data-surface="server-error"[^>]*role="region"/.test(server.body);
    const svRetry = /data-recovery="retry"/.test(server.body);
    const svNoStack = !/data-leak="stack"/.test(server.body);
    const svPass = server.status === 500 && !!server.requestId && svRegion && svRetry && svNoStack;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22103-1',
      verdict: svPass ? 'pass' : 'fail',
      detail: svPass
        ? `GET /probe/server-error returned 500 with role="region", retry recovery control, no leaked stack trace; x-fixture-request-id=${server.requestId}`
        : `server-error evidence gap: status=${server.status} rid=${server.requestId} region=${svRegion} retry=${svRetry} noStack=${svNoStack}`,
      evidence: {
        requestId: server.requestId,
        responseStatus: server.status,
        bodyExcerpt: excerpt((server.body.match(/data-surface="server-error"[^]{0,200}/) || [''])[0]),
        derived: { region: svRegion, retry: svRetry, noStack: svNoStack },
      },
    });

    const brokenStack = await fixtureFetch(fixture.url, '/probe/server-error?break=stack-trace');
    const brokenHasStack = /data-leak="stack"/.test(brokenStack.body);
    const varyStackPass = brokenStack.status === 500 && !!brokenStack.requestId && brokenHasStack;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22103-1',
      verdict: varyStackPass ? 'pass' : 'fail',
      detail: varyStackPass
        ? `GET /probe/server-error?break=stack-trace returned 500 with a data-leak="stack" block present (the AC-22103-1 stack-trace check would refuse); x-fixture-request-id=${brokenStack.requestId}`
        : `break=stack-trace evidence gap: status=${brokenStack.status} rid=${brokenStack.requestId} stackPresent=${brokenHasStack}`,
      evidence: {
        requestId: brokenStack.requestId,
        responseStatus: brokenStack.status,
        bodyExcerpt: excerpt((brokenStack.body.match(/data-leak="stack"[^]{0,180}/) || [''])[0]),
        derived: { brokenHasStack },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
