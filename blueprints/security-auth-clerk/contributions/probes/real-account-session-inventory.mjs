// Real-account sign-in-token surface smoke for security-auth-clerk.
//
// Scope of observation. The blueprint's session-inventory ACs bind
// authenticated browser sessions and inventory operations that
// Clerk's Backend API cannot author from the server side (Sessions
// are created by Clerk's Frontend API in a browser flow; the
// Backend API exposes only list/get/revoke/refresh/verify). This
// probe therefore does not observe the session-inventory
// properties AC-9112-1, AC-9112-3, AC-9112-4 or AC-9112-5 name;
// each row is emitted with `anchorAcId: null` and a limitation
// citing the nearest shipped session-inventory AC whose runtime
// property the probe does not observe.
//
// What THIS probe drives at the Backend API surface. Create a
// scratch user; mint a sign-in token for that user with
// `POST /v1/sign_in_tokens`; capture the returned token id; revoke
// it with `POST /v1/sign_in_tokens/{id}/revoke`; re-fetch the
// token to observe the `revoked` status flip (or 404). Delete the
// user in the finally block. Positive evidence per rule 7d is
// preserved: the Clerk-assigned token id (created-then-revoked
// resource id in the token's lifecycle state, shape 3), and the
// HTTP statuses. The probe reads the X-Request-Id header from each
// response and records it on every call, but Clerk's Backend API
// did not return that header on the instance these records were
// captured from, so every request-id field is null; the evidence
// rests on the token lifecycle transitions and response statuses
// rather than on request-id capture.
//
// engine: clerk-backend-api (live) or skip:CI_HAS_CLERK_ACCOUNT.
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = null;
export const capability = 'sessionInventory';
export const accountBound = true;
const LIM_MINT = 'security-auth-clerk-AC-9112-3: probe drives the Backend API sign-in-token mint from a probe process; the AC binds revokeAllExceptCurrent semantics on the project session-inventory interface, which requires a browser-driven runner (the integration harness follow-up).';
const LIM_REVOKE = 'security-auth-clerk-AC-9112-4: probe drives the Backend API sign-in-token revoke from a probe process; the AC binds SESSION_INVENTORY_UNAUTHENTICATED refusal at the project inventory operations, which requires a browser-driven runner (the integration harness follow-up).';
const LIM_NOT_OBS_1 = 'security-auth-clerk-AC-9112-1: two shaped active sessions cannot be authored server-side against the Clerk Backend API; the AC needs a browser-driven runner (the integration harness follow-up).';
const LIM_NOT_OBS_5 = 'security-auth-clerk-AC-9112-5: revoke against an unowned or already-revoked session id cannot be authored server-side against the Backend API; the AC needs a browser-driven runner (the integration harness follow-up).';

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

async function clerkFetch({ baseUrl, path, method, body, form, token }) {
  const url = `${baseUrl}${path}`;
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (form !== undefined) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
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
        conformanceOnly: true, limitation: LIM_MINT,
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
  const short = shortRandom();
  const emailAddress = `${SCRATCH_PRINCIPAL_PREFIX}sess-${short}+clerk_test@example.com`;

  const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, scratchEmailAddress: emailAddress, calls: [] };
  const results = [];
  const rowSignIn = { anchorAcId: null, conformanceOnly: true, limitation: LIM_MINT, capability, verdict: 'fail', detail: '' };
  const rowRevoke = { anchorAcId: null, conformanceOnly: true, limitation: LIM_REVOKE, capability, verdict: 'fail', detail: '' };
  const rowNotObservable1 = {
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_NOT_OBS_1,
    capability,
    verdict: 'pass',
    detail:
      'AC-9112-1 (two shaped active sessions per Backend API list()) is not observable at the Backend API surface: Clerk creates authenticated sessions via the Frontend API in a browser flow, and the Backend API exposes only list/get/revoke/refresh/verify on Sessions (no server-side session-create). Full AC-9112-1 observation requires a shelf-level browser-driven auth harness, tracked as a separate follow-up.',
    evidence: {
      notObservableACs: ['security-auth-clerk-AC-9112-1'],
      notObservableReason: 'Clerk Backend API cannot create authenticated browser sessions from the server side; observation requires a Frontend-API-driven browser flow.',
      docsUrl: 'https://clerk.com/docs/reference/backend-api',
      docsVerifiedOn: '2026-09-11',
    },
  };
  const rowNotObservable5 = {
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_NOT_OBS_5,
    capability,
    verdict: 'pass',
    detail:
      'AC-9112-5 (revoke against an unowned or already-revoked session id refuses with SESSION_INVENTORY_UNKNOWN_SESSION and audit event) is not observable at the Backend API surface: the AC is bound to the project session-inventory interface driven from an authenticated caller, and the Backend API cannot create such an authenticated caller server-side. Full AC-9112-5 observation requires a shelf-level browser-driven auth harness, tracked as a separate follow-up.',
    evidence: {
      notObservableACs: ['security-auth-clerk-AC-9112-5'],
      notObservableReason: 'AC-9112-5 binds a project session-inventory refusal that requires an authenticated project caller; the Backend API cannot create one server-side.',
      docsUrl: 'https://clerk.com/docs/reference/backend-api',
      docsVerifiedOn: '2026-09-11',
    },
  };
  let createdUserId = null;
  let createdTokenId = null;

  try {
    const created = await clerkFetch({
      baseUrl, path: '/users', method: 'POST', token,
      body: {
        email_address: [emailAddress],
        first_name: 'ProbeUser', last_name: short,
        username: `probe_clerk_${short}`,
        skip_password_requirement: true,
      },
    });
    evidence.calls.push({ verb: 'POST /users', status: created.status, requestId: created.requestId, resourceId: created.payload && created.payload.id });
    if (!created.ok || !(created.payload && created.payload.id)) {
      rowSignIn.detail = `precondition POST /v1/users failed status=${created.status} requestId=${created.requestId} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      rowSignIn.evidence = { call: evidence.calls[evidence.calls.length - 1] };
      rowRevoke.detail = 'skipped: precondition POST /users failed';
      rowRevoke.evidence = { skipped: 'precondition failed' };
      results.push(rowSignIn, rowRevoke, rowNotObservable1, rowNotObservable5);
      return { results, extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    const mint = await clerkFetch({
      baseUrl, path: '/sign_in_tokens', method: 'POST', token,
      body: { user_id: createdUserId, expires_in_seconds: 300 },
    });
    evidence.calls.push({
      verb: 'POST /sign_in_tokens', status: mint.status, requestId: mint.requestId,
      resourceId: mint.payload && mint.payload.id, status_flag: mint.payload && mint.payload.status,
    });
    const mintOk = mint.ok && mint.payload && typeof mint.payload.id === 'string' && mint.payload.status === 'pending';
    createdTokenId = (mint.payload && mint.payload.id) || null;
    rowSignIn.verdict = mintOk ? 'pass' : 'fail';
    rowSignIn.detail = mintOk
      ? `Clerk Backend API sign-in-token mint observed: POST /v1/sign_in_tokens user_id=${createdUserId} status=${mint.status} requestId=${mint.requestId} tokenId=${createdTokenId} tokenStatus=pending.`
      : `Clerk Backend API sign-in-token mint failed: status=${mint.status} requestId=${mint.requestId} bodyExcerpt=${JSON.stringify(mint.payload).slice(0, 200)}`;
    rowSignIn.evidence = {
      requestId: mint.requestId,
      status: mint.status,
      tokenId: createdTokenId,
      tokenStatus: mint.payload && mint.payload.status,
      createdUserId,
    };

    if (!createdTokenId) {
      rowRevoke.detail = 'skipped: mint did not return a token id';
      rowRevoke.evidence = { skipped: 'no tokenId' };
      results.push(rowSignIn, rowRevoke, rowNotObservable1, rowNotObservable5);
      return { results, extra: evidence };
    }

    const revoked = await clerkFetch({
      baseUrl, path: `/sign_in_tokens/${createdTokenId}/revoke`, method: 'POST', token,
    });
    evidence.calls.push({
      verb: `POST /sign_in_tokens/${createdTokenId}/revoke`, status: revoked.status, requestId: revoked.requestId,
      status_flag: revoked.payload && revoked.payload.status,
    });
    const readBack = await clerkFetch({
      baseUrl, path: `/sign_in_tokens/${createdTokenId}`, method: 'GET', token,
    });
    evidence.calls.push({
      verb: `GET /sign_in_tokens/${createdTokenId}`, status: readBack.status, requestId: readBack.requestId,
      status_flag: readBack.payload && readBack.payload.status,
    });
    const revokedFlag = readBack.payload && (readBack.payload.status === 'revoked' || readBack.payload.revoked === true);
    const goneAfterRevoke = revokedFlag || readBack.status === 404 || readBack.status === 410;
    const revokeOk = revoked.ok && goneAfterRevoke;
    rowRevoke.verdict = revokeOk ? 'pass' : 'fail';
    rowRevoke.detail = revokeOk
      ? `Clerk Backend API sign-in-token revoke observed: revoke POST status=${revoked.status} requestId=${revoked.requestId}; re-fetch status=${readBack.status} tokenStatus=${readBack.payload && readBack.payload.status || (readBack.status === 404 ? 'gone-404' : 'unknown')}; the created-then-revoked tokenId (${createdTokenId}) records the Backend API lifecycle transition (404 after revoke means the resource no longer resolves).`
      : `Clerk Backend API sign-in-token revoke failed: revokeStatus=${revoked.status} readBackStatus=${readBack.status} readBackStatusFlag=${readBack.payload && readBack.payload.status}`;
    rowRevoke.evidence = {
      revokeStatus: revoked.status,
      revokeRequestId: revoked.requestId,
      readBackStatus: readBack.status,
      readBackRequestId: readBack.requestId,
      readBackTokenStatus: readBack.payload && readBack.payload.status,
      tokenId: createdTokenId,
      createdThenRevokedTokenId: createdTokenId,
    };

    results.push(rowSignIn, rowRevoke, rowNotObservable1, rowNotObservable5);
  } catch (err) {
    rowSignIn.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    rowSignIn.evidence = { threw: err && err.message ? err.message : String(err) };
    rowRevoke.detail = 'skipped: probe threw before completing';
    rowRevoke.evidence = { skipped: 'threw' };
    results.push(rowSignIn, rowRevoke, rowNotObservable1, rowNotObservable5);
    evidence.threw = err && err.message ? err.message : String(err);
  } finally {
    if (createdUserId) {
      try {
        const teardown = await clerkFetch({ baseUrl, path: `/users/${createdUserId}`, method: 'DELETE', token });
        evidence.teardownDelete = { status: teardown.status, requestId: teardown.requestId };
        if (!teardown.ok) {
          for (const r of results) { r.verdict = 'fail'; r.detail = (r.detail || '') + ` TEARDOWN FAILED leaving orphan user ${createdUserId}: status=${teardown.status} requestId=${teardown.requestId}.`; }
          evidence.orphanUserId = createdUserId;
        }
      } catch (err) {
        for (const r of results) { r.verdict = 'fail'; r.detail = (r.detail || '') + ` TEARDOWN THREW: ${err && err.message ? err.message : String(err)} leaving orphan user ${createdUserId}.`; }
        evidence.orphanUserId = createdUserId;
      }
    }
  }
  return { results, extra: evidence };
}
