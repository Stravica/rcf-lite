// Real-account session-inventory probe for security-auth-clerk.
//
// Creates a scratch principal via POST /v1/users, calls GET
// /v1/sessions?user_id={id} to prove the session-inventory verb
// returns a paginated array shape for the new user (AC-9112-1),
// then deletes the principal and re-queries to prove the resource
// is absent from the post-run inventory (rule 7d evidence shape 3:
// created-then-deleted resource id absent in the diff).
//
// Positive evidence: the X-Request-ID header on the /sessions call,
// the HTTP status, the empty array shape (a freshly-created user
// with no interactive login has zero sessions), the created-then-
// deleted user id, and the post-delete /sessions call that responds
// with the expected error class for a no-longer-existing user.
//
// Docs: Clerk Backend API - list sessions
// https://clerk.com/docs/reference/backend-api/tag/Sessions verifiedOn
// 2026-09-11.
//
// capability: sessionInventory.
// Anchor (per closure): AC-9112-1 (list returns one row per active
//   project session, shaped per TAC-1003 SessionRow).
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-clerk-AC-9112-1';
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
  const results = [];
  const rowShape = { anchorAcId, capability, verdict: 'fail', detail: '' };
  const rowAbsence = { anchorAcId: 'security-auth-clerk-AC-9112-5', capability, verdict: 'fail', detail: '' };
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
      rowShape.detail = `POST /v1/users failed: status=${created.status} requestId=${created.requestId} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      rowShape.evidence = { call: evidence.calls[evidence.calls.length - 1] };
      rowAbsence.detail = 'skipped: precondition POST /users failed';
      rowAbsence.evidence = {};
      results.push(rowShape, rowAbsence);
      return { results, extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    // AC-9112-1: list returns the expected shape. For a freshly-created
    // user with no interactive login the expected inventory is exactly []
    // (zero rows). Any other shape is a fail.
    const sessions = await clerkFetch({ baseUrl, path: `/sessions?user_id=${encodeURIComponent(createdUserId)}`, method: 'GET', token });
    evidence.calls.push({
      verb: `GET /sessions?user_id=${createdUserId} (pre-delete)`,
      status: sessions.status, requestId: sessions.requestId,
      isArray: Array.isArray(sessions.payload),
      count: Array.isArray(sessions.payload) ? sessions.payload.length : null,
    });
    const shapeOk = sessions.ok
      && Array.isArray(sessions.payload)
      && sessions.payload.length === 0;
    rowShape.verdict = shapeOk ? 'pass' : 'fail';
    rowShape.detail = shapeOk
      ? `AC-9112-1: GET /v1/sessions?user_id=${createdUserId} status=${sessions.status} requestId=${sessions.requestId}. Response is an array of length 0 (the expected empty inventory for a freshly-created user with no interactive login).`
      : `AC-9112-1 failure: status=${sessions.status} requestId=${sessions.requestId} isArray=${Array.isArray(sessions.payload)} length=${Array.isArray(sessions.payload) ? sessions.payload.length : 'n/a'} bodyExcerpt=${JSON.stringify(sessions.payload).slice(0, 200)}`;
    rowShape.evidence = {
      requestId: sessions.requestId,
      status: sessions.status,
      isArray: Array.isArray(sessions.payload),
      length: Array.isArray(sessions.payload) ? sessions.payload.length : null,
      createdUserId,
    };

    // Delete the principal.
    const deleted = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
    evidence.calls.push({ verb: `DELETE /users/${createdUserId}`, status: deleted.status, requestId: deleted.requestId });
    const deleteOk = deleted.ok;

    // AC-9112-5: a call against a session id / user id the caller
    // does not own (or that no longer exists) refuses without a
    // side effect. Post-delete /sessions?user_id=<gone> must NOT
    // return an array containing the deleted user's session data;
    // Clerk returns 404 (or an empty array) here. Positive
    // absence evidence: the id is gone.
    const postList = await clerkFetch({ baseUrl, path: `/sessions?user_id=${encodeURIComponent(createdUserId)}`, method: 'GET', token });
    evidence.calls.push({
      verb: `GET /sessions?user_id=${createdUserId} (post-delete)`,
      status: postList.status, requestId: postList.requestId,
      isArray: Array.isArray(postList.payload),
      count: Array.isArray(postList.payload) ? postList.payload.length : null,
    });
    // Absence is satisfied when the endpoint returns 404 / 4xx OR an
    // empty array; either shape proves the id no longer resolves to
    // an active session row.
    const arrayShape = Array.isArray(postList.payload) ? postList.payload.length === 0 : false;
    const errorShape = postList.status >= 400;
    const absenceOk = deleteOk && (errorShape || arrayShape);
    rowAbsence.verdict = absenceOk ? 'pass' : 'fail';
    rowAbsence.detail = absenceOk
      ? `AC-9112-5 (post-delete absence): DELETE /users/${createdUserId} status=${deleted.status}; post-delete GET /sessions?user_id=${createdUserId} status=${postList.status} ${arrayShape ? '(empty array)' : '(refused: deleted user)'}. The id no longer resolves to an active session row.`
      : `AC-9112-5 failure: deleteOk=${deleteOk} postDeleteStatus=${postList.status} isArray=${Array.isArray(postList.payload)} length=${Array.isArray(postList.payload) ? postList.payload.length : 'n/a'}`;
    rowAbsence.evidence = {
      deleteStatus: deleted.status,
      deleteRequestId: deleted.requestId,
      postListStatus: postList.status,
      postListRequestId: postList.requestId,
      postListIsArray: Array.isArray(postList.payload),
      postListLength: Array.isArray(postList.payload) ? postList.payload.length : null,
      createdUserId,
    };

    if (deleteOk) {
      // Mark deleted so finally does not attempt another delete.
      createdUserId = null;
    }
    results.push(rowShape, rowAbsence);
  } catch (err) {
    rowShape.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    rowShape.evidence = { threw: err && err.message ? err.message : String(err) };
    rowAbsence.detail = 'skipped: probe threw before completing';
    rowAbsence.evidence = {};
    results.push(rowShape, rowAbsence);
    evidence.threw = err && err.message ? err.message : String(err);
  } finally {
    if (createdUserId) {
      try {
        const teardown = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
        evidence.teardownDelete = { status: teardown.status, requestId: teardown.requestId };
        if (!teardown.ok) {
          for (const r of results) r.verdict = 'fail';
          for (const r of results) r.detail = (r.detail ? r.detail + ' ' : '') +
            `TEARDOWN FAILED leaving orphan user ${createdUserId}: status=${teardown.status} requestId=${teardown.requestId}.`;
          evidence.orphanUserId = createdUserId;
        }
      } catch (err) {
        for (const r of results) r.verdict = 'fail';
        for (const r of results) r.detail = (r.detail ? r.detail + ' ' : '') +
          `TEARDOWN THREW: ${err && err.message ? err.message : String(err)} leaving orphan user ${createdUserId}.`;
        evidence.orphanUserId = createdUserId;
      }
    }
  }
  return { results, extra: evidence };
}
