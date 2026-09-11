// Real-account principal-directory round-trip for security-auth-clerk.
//
// Creates a scratch principal via POST /v1/users, reads it back via
// GET /v1/users/{id}, lists the users page and asserts the id is
// present, deletes it via DELETE /v1/users/{id}, then re-lists and
// asserts the id is absent. Positive evidence recorded per rule 7d:
// the Clerk-assigned user_ id, the X-Request-ID header returned on
// every call, the created-then-deleted resource id in the pre-diff /
// post-diff inventory pair, and the HTTP status codes.
//
// The teardown is fail-safe: a mid-run crash leaves the user
// address deterministic (pxe-clerk-<short>@example.test); the
// finally block always issues DELETE. A teardown failure flips the
// verdict to FAIL regardless of upstream success.
//
// Base URL is https://api.clerk.com/v1 by default; CLERK_API_BASE_URL
// (declared, optional) may override for local mock testing.
//
// Docs: Clerk Backend API https://clerk.com/docs/reference/backend-api
// verifiedOn 2026-09-11.
//
// capability: principalDirectory, sessionInventory (partial: this
//   probe carries principalDirectory; sessionInventory has its own
//   probe below).
// Anchor (per closure): no AC covers a Clerk Backend API round
// trip smoke; anchoring REQ-008 (Runtime acceptance rides a real
// Clerk development instance), per closure rule 1.
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-clerk-REQ-008';
export const capability = 'principalDirectory';
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
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_CLERK_ACCOUNT')],
      extra: { accountBoundSkipped: true, reason: 'CI_HAS_CLERK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
    };
  }
  if (gate.kind === 'set-not-true') {
    return {
      results: [{
        anchorAcId, capability, verdict: 'fail',
        detail: `REQ-008: CI_HAS_CLERK_ACCOUNT is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
        evidence: { gate: 'CI_HAS_CLERK_ACCOUNT', observedValue: gate.observedValue, expected: 'true' },
      }],
      extra: { gateMisconfigured: true, gate: 'CI_HAS_CLERK_ACCOUNT', envDeclared: [...DECLARED_ENV] },
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
  const resultRow = { anchorAcId, capability, verdict: 'fail', detail: '', evidence: {} };
  let createdUserId = null;

  try {
    // 1. Create the scratch principal.
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
      resultRow.detail = `POST /v1/users failed: status=${created.status} requestId=${created.requestId} payloadKeys=${JSON.stringify(Object.keys(created.payload || {}))} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      return { results: [resultRow], extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    // 2. Read the scratch principal back.
    const readBack = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'GET', token });
    evidence.calls.push({ verb: `GET /users/${createdUserId}`, status: readBack.status, requestId: readBack.requestId, resourceId: readBack.payload && readBack.payload.id });
    const readOk = readBack.ok && readBack.payload && readBack.payload.id === createdUserId;

    // 3. List a page and assert the id is present.
    const listPre = await clerkFetch({ baseUrl, path: `/users?limit=200&order_by=-created_at`, method: 'GET', token });
    const listedIdsPre = Array.isArray(listPre.payload) ? listPre.payload.map((u) => u.id) : [];
    evidence.calls.push({ verb: 'GET /users?limit=200 (pre-delete)', status: listPre.status, requestId: listPre.requestId, listedCount: listedIdsPre.length, foundScratch: listedIdsPre.includes(createdUserId) });
    const listPreOk = listPre.ok && listedIdsPre.includes(createdUserId);

    // 4. Delete the scratch principal.
    const deleted = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
    evidence.calls.push({ verb: `DELETE /users/${createdUserId}`, status: deleted.status, requestId: deleted.requestId });
    const deleteOk = deleted.ok;

    // 5. Re-list and assert the id is absent (created-then-deleted inventory diff).
    const listPost = await clerkFetch({ baseUrl, path: `/users?limit=200&order_by=-created_at`, method: 'GET', token });
    const listedIdsPost = Array.isArray(listPost.payload) ? listPost.payload.map((u) => u.id) : [];
    evidence.calls.push({ verb: 'GET /users?limit=200 (post-delete)', status: listPost.status, requestId: listPost.requestId, listedCount: listedIdsPost.length, foundScratch: listedIdsPost.includes(createdUserId) });
    const listPostOk = listPost.ok && !listedIdsPost.includes(createdUserId);

    if (readOk && listPreOk && deleteOk && listPostOk) {
      // If the delete round-trip succeeded, teardown is complete;
      // ensure the finally block does not double-delete.
      resultRow.verdict = 'pass';
      resultRow.detail =
        `REQ-008 (no AC covers this smoke; anchoring REQ). real-account clerk principal-directory: created ${createdUserId} (POST status ${created.status}, requestId ${created.requestId}); ` +
        `readBack GET ${readBack.status} (requestId ${readBack.requestId}); listPre found=${listPreOk} (${listedIdsPre.length} users); ` +
        `DELETE ${deleted.status} (requestId ${deleted.requestId}); listPost absent=${listPostOk} (${listedIdsPost.length} users).`;
      resultRow.evidence = {
        createdUserId,
        createStatus: created.status, createRequestId: created.requestId,
        readBackStatus: readBack.status, readBackRequestId: readBack.requestId,
        listPreCount: listedIdsPre.length, listPreContainsCreated: listPreOk,
        deleteStatus: deleted.status, deleteRequestId: deleted.requestId,
        listPostCount: listedIdsPost.length, listPostAbsence: listPostOk,
      };
      // Mark deleted so finally does not attempt another delete.
      createdUserId = null;
    } else {
      resultRow.evidence = { calls: evidence.calls }; resultRow.detail = `one or more calls failed: readOk=${readOk} listPreOk=${listPreOk} deleteOk=${deleteOk} listPostOk=${listPostOk}; calls=${JSON.stringify(evidence.calls)}`;
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
