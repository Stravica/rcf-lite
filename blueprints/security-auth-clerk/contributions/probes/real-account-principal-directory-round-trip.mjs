// Real-account principal-directory smoke for security-auth-clerk.
//
// Conformance-only. This probe drives the Clerk Backend API
// principal-directory (users) surface end to end (create + read +
// list + delete + list-diff) and records what the Backend API
// returned. The blueprint's shipped principal-directory acceptance
// criteria bind runtime sign-in and session semantics on the
// project's own middleware; a Backend API smoke against
// api.clerk.com does not observe those runtime properties, so the
// row is emitted with `anchorAcId: null` and a limitation naming
// the nearest shipped AC whose property the probe does not
// observe. Positive evidence per rule 7d is preserved on the row:
// the Clerk-assigned user_ id, the X-Request-ID header returned on
// every call, the created-then-deleted resource id in the pre-diff
// / post-diff inventory pair, and the HTTP status codes.
//
// Teardown is fail-safe: a mid-run crash leaves the user address
// deterministic; the finally block always issues DELETE. A
// teardown failure flips the verdict to FAIL regardless of
// upstream success.
//
// Base URL is https://api.clerk.com/v1 by default; CLERK_API_BASE_URL
// (declared, optional) may override for local mock testing.
//
// Docs: Clerk Backend API https://clerk.com/docs/reference/backend-api
// verifiedOn 2026-09-11.
//
// capability: principalDirectory.
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = null;
export const capability = 'principalDirectory';
export const accountBound = true;
// AC-9110-1 states the project runtime does not create, update, or
// delete users on Clerk. This probe drives the Backend API from a
// probe process, not the project runtime, so it cannot observe the
// runtime property AC-9110-1 states; the row records that limit
// alongside the raw Backend API evidence it did capture.
const DECLAIM_LIMITATION = 'security-auth-clerk-AC-9110-1: probe drives the Clerk Backend API users surface from a probe process; the AC states the project runtime does not create, update or delete users on Clerk, which requires observing the deployed runtime through the integration harness follow-up.';

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
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
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

function gateResult(varName, value) {
  if (value === undefined || value === '') return { kind: 'unset', reason: varName };
  if (value !== 'true') return { kind: 'set-not-true', reason: `${varName}_SET_NOT_TRUE`, observedValue: value };
  return { kind: 'true' };
}

export default async function runProbe() {
  const gate = gateResult('CI_HAS_CLERK_ACCOUNT', process.env.CI_HAS_CLERK_ACCOUNT);
  if (gate.kind === 'unset') {
    return {
      results: [accountBoundSkippedResult(null, capability, 'CI_HAS_CLERK_ACCOUNT')],
      extra: { accountBoundSkipped: true, reason: 'CI_HAS_CLERK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
    };
  }
  if (gate.kind === 'set-not-true') {
    return {
      results: [{
        anchorAcId: null, capability, verdict: 'fail',
        conformanceOnly: true, limitation: DECLAIM_LIMITATION,
        detail: `conformance-only: CI_HAS_CLERK_ACCOUNT is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
        evidence: { gate: 'CI_HAS_CLERK_ACCOUNT', observedValue: gate.observedValue, expected: 'true' },
      }],
      extra: { gateMisconfigured: true, gate: 'CI_HAS_CLERK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
    };
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return {
      results: [accountBoundSkippedResult(null, capability, 'CLERK_SECRET_KEY')],
      extra: { accountBoundSkipped: true, reason: 'CLERK_SECRET_KEY', envDeclared: [...DECLARED_ENV] },
    };
  }

  const baseUrl = process.env.CLERK_API_BASE_URL || BASE_URL_DEFAULT;
  const token = process.env.CLERK_SECRET_KEY;
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const short = shortRandom();
  const emailAddress = `${SCRATCH_PRINCIPAL_PREFIX}${short}+clerk_test@example.com`;

  const evidence = {
    envDeclared: [...DECLARED_ENV],
    baseUrl,
    scratchEmailAddress: emailAddress,
    runId,
    calls: [],
  };
  const resultRow = { anchorAcId: null, conformanceOnly: true, limitation: DECLAIM_LIMITATION, capability, verdict: 'fail', detail: '', evidence: {} };
  let createdUserId = null;

  try {
    const created = await clerkFetch({
      baseUrl,
      path: '/users',
      method: 'POST',
      token,
      body: {
        email_address: [emailAddress],
        first_name: 'ProbeUser',
        last_name: short,
        username: `probe_clerk_${short}`,
        skip_password_requirement: true,
      },
    });
    evidence.calls.push({ verb: 'POST /users', status: created.status, requestId: created.requestId, resourceId: created.payload && created.payload.id });
    if (!created.ok || !(created.payload && created.payload.id)) {
      resultRow.detail = `POST /v1/users failed: status=${created.status} requestId=${created.requestId} payloadKeys=${JSON.stringify(Object.keys(created.payload || {}))} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      return { results: [resultRow], extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    const readBack = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'GET', token });
    evidence.calls.push({ verb: `GET /users/${createdUserId}`, status: readBack.status, requestId: readBack.requestId, resourceId: readBack.payload && readBack.payload.id });
    const readOk = readBack.ok && readBack.payload && readBack.payload.id === createdUserId;

    const listPre = await clerkFetch({ baseUrl, path: `/users?limit=200&order_by=-created_at`, method: 'GET', token });
    const listedIdsPre = Array.isArray(listPre.payload) ? listPre.payload.map((u) => u.id) : [];
    evidence.calls.push({ verb: 'GET /users?limit=200 (pre-delete)', status: listPre.status, requestId: listPre.requestId, listedCount: listedIdsPre.length, foundScratch: listedIdsPre.includes(createdUserId) });
    const listPreOk = listPre.ok && listedIdsPre.includes(createdUserId);

    const deleted = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
    evidence.calls.push({ verb: `DELETE /users/${createdUserId}`, status: deleted.status, requestId: deleted.requestId });
    const deleteOk = deleted.ok;

    const listPost = await clerkFetch({ baseUrl, path: `/users?limit=200&order_by=-created_at`, method: 'GET', token });
    const listedIdsPost = Array.isArray(listPost.payload) ? listPost.payload.map((u) => u.id) : [];
    evidence.calls.push({ verb: 'GET /users?limit=200 (post-delete)', status: listPost.status, requestId: listPost.requestId, listedCount: listedIdsPost.length, foundScratch: listedIdsPost.includes(createdUserId) });
    const listPostOk = listPost.ok && !listedIdsPost.includes(createdUserId);

    if (readOk && listPreOk && deleteOk && listPostOk) {
      resultRow.verdict = 'pass';
      resultRow.detail =
        `Clerk Backend API users surface observation: created ${createdUserId} (POST status ${created.status}, requestId ${created.requestId}); ` +
        `readBack GET ${readBack.status} (requestId ${readBack.requestId}); listPre observed ${listedIdsPre.length} users, created id present; ` +
        `DELETE ${deleted.status} (requestId ${deleted.requestId}); listPost observed ${listedIdsPost.length} users, created id absent.`;
      resultRow.evidence = {
        createdUserId,
        createStatus: created.status, createRequestId: created.requestId,
        readBackStatus: readBack.status, readBackRequestId: readBack.requestId,
        listPreCount: listedIdsPre.length, listPreContainsCreated: listPreOk,
        deleteStatus: deleted.status, deleteRequestId: deleted.requestId,
        listPostCount: listedIdsPost.length, listPostAbsence: listPostOk,
      };
      createdUserId = null;
    } else {
      resultRow.evidence = { calls: evidence.calls }; resultRow.detail = `one or more Backend API calls failed: readOk=${readOk} listPreOk=${listPreOk} deleteOk=${deleteOk} listPostOk=${listPostOk}; calls=${JSON.stringify(evidence.calls)}`;
    }
  } catch (err) {
    resultRow.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    resultRow.evidence = { threw: err && err.message ? err.message : String(err) };
    evidence.threw = err && err.message ? err.message : String(err);
  } finally {
    if (createdUserId) {
      try {
        const teardown = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
        evidence.teardownDelete = { status: teardown.status, requestId: teardown.requestId };
        if (!teardown.ok) {
          resultRow.verdict = 'fail';
          resultRow.detail = (resultRow.detail ? resultRow.detail + ' ' : '') +
            `TEARDOWN FAILED leaving orphan user ${createdUserId}: DELETE status=${teardown.status} requestId=${teardown.requestId}. This run is FAIL-WITH-ORPHAN.`;
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
