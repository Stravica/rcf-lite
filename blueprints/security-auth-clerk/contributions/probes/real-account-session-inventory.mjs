// Real-account session-inventory probe for security-auth-clerk.
//
// Creates a scratch principal via POST /v1/users, calls GET
// /v1/sessions?user_id={id} to prove the session-inventory verb
// returns a paginated array shape for the new user, then deletes
// the principal. TAC-1003 (session verifier) contracts against
// exactly this endpoint; a live call proves the endpoint answers,
// the shape is honoured, and the (empty) session list is returned
// as an array. Evidence: the X-Request-ID header on the /sessions
// call, the HTTP status, and the array shape returned.
//
// Docs: Clerk Backend API - list sessions
// https://clerk.com/docs/reference/backend-api/tag/Sessions verifiedOn
// 2026-09-11.
//
// capability: sessionInventory.
// anchorAcId: security-auth-clerk-AC-9103-1.
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-clerk-AC-9103-1';
export const capability = 'sessionInventory';
export const accountBound = true;

const BASE_URL_DEFAULT = 'https://api.clerk.com/v1';

function shortRandom() {
  return Math.random().toString(36).slice(2, 10);
}

function pickRequestId(headers) {
  return (
    headers.get('x-request-id') ||
    headers.get('cf-request-id') ||
    headers.get('x-clerk-request-id') ||
    null
  );
}

async function clerkFetch({ baseUrl, path, method, body, token }) {
  const url = `${baseUrl}${path}`;
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const requestId = pickRequestId(res.headers);
  let payload = null;
  const text = await res.text();
  if (text.length > 0) {
    try { payload = JSON.parse(text); } catch { payload = { rawText: text.slice(0, 200) }; }
  }
  return { status: res.status, ok: res.ok, requestId, payload };
}

export default async function runProbe() {
  if (process.env.CI_HAS_CLERK_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_CLERK_ACCOUNT')],
      extra: { accountBoundSkipped: true, reason: 'CI_HAS_CLERK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
    };
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CLERK_SECRET_KEY')],
      extra: { accountBoundSkipped: true, reason: 'CLERK_SECRET_KEY', envDeclared: [...DECLARED_ENV] },
    };
  }

  const baseUrl = process.env.CLERK_API_BASE_URL || BASE_URL_DEFAULT;
  const token = process.env.CLERK_SECRET_KEY;
  const short = shortRandom();
  const emailAddress = `${SCRATCH_PRINCIPAL_PREFIX}sess-${short}+clerk_test@example.com`;

  const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, scratchEmailAddress: emailAddress, calls: [] };
  const resultRow = { anchorAcId, capability, verdict: 'fail', detail: '' };
  let createdUserId = null;

  try {
    const created = await clerkFetch({
      baseUrl,
      path: '/users',
      method: 'POST',
      token,
      body: {
        email_address: [emailAddress],
        first_name: 'QAProbe',
        last_name: short,
        username: `qa_e_clerk_${short}`,
        skip_password_requirement: true,
      },
    });
    evidence.calls.push({ verb: 'POST /users', status: created.status, requestId: created.requestId, resourceId: created.payload && created.payload.id });
    if (!created.ok || !(created.payload && created.payload.id)) {
      resultRow.detail = `POST /v1/users failed: status=${created.status} requestId=${created.requestId} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      return { results: [resultRow], extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    const sessions = await clerkFetch({ baseUrl, path: `/sessions?user_id=${encodeURIComponent(createdUserId)}`, method: 'GET', token });
    evidence.calls.push({ verb: `GET /sessions?user_id=${createdUserId}`, status: sessions.status, requestId: sessions.requestId, isArray: Array.isArray(sessions.payload), count: Array.isArray(sessions.payload) ? sessions.payload.length : null });

    const shapeOk = sessions.ok && Array.isArray(sessions.payload);
    if (shapeOk) {
      resultRow.verdict = 'pass';
      resultRow.detail =
        `real-account clerk session-inventory: created ${createdUserId}; GET /v1/sessions?user_id=${createdUserId} status ${sessions.status} requestId ${sessions.requestId}; ` +
        `response is array of length ${sessions.payload.length} (a freshly-created user with no interactive login has zero sessions, which is the correct honest shape).`;
    } else {
      resultRow.detail = `session-inventory failed: status=${sessions.status} requestId=${sessions.requestId} isArray=${Array.isArray(sessions.payload)} bodyExcerpt=${JSON.stringify(sessions.payload).slice(0, 200)}`;
    }
  } catch (err) {
    resultRow.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    evidence.threw = err && err.message ? err.message : String(err);
  } finally {
    if (createdUserId) {
      try {
        const teardown = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
        evidence.teardownDelete = { status: teardown.status, requestId: teardown.requestId };
        if (!teardown.ok) {
          resultRow.verdict = 'fail';
          resultRow.detail = (resultRow.detail ? resultRow.detail + ' ' : '') +
            `TEARDOWN FAILED leaving orphan user ${createdUserId}: status=${teardown.status} requestId=${teardown.requestId}.`;
          evidence.orphanUserId = createdUserId;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = (resultRow.detail ? resultRow.detail + ' ' : '') +
          `TEARDOWN THREW: ${err && err.message ? err.message : String(err)} leaving orphan user ${createdUserId}.`;
        evidence.orphanUserId = createdUserId;
      }
    }
  }
  return { results: [resultRow], extra: evidence };
}
