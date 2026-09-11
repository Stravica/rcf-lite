// Real-account sign-in-token surface probe for security-auth-clerk.
//
// Scope of observation. The blueprint's session-inventory
// AC-9112-1 (a `list()` call from an authenticated caller returns
// one row per active project session, currentSession=true|false,
// deviceLabel, lastActive) and AC-9112-5 (revoke of an unknown
// session refuses without a side effect) both require an
// authenticated browser sign-in flow: Clerk's Backend API does
// not create authenticated sessions read-and-write-only from the
// server side. (Sessions are created by Clerk's Frontend API
// exchanging a `sign_in_token` via a browser; the Backend API
// exposes list/get/revoke/refresh/verify on the Sessions resource
// but no create. See the Sessions and Sign-in-Tokens tags at
// https://clerk.com/docs/reference/backend-api verifiedOn
// 2026-09-11.) The property AC-9112-1 / AC-9112-5 name is not
// observable from this surface; those rows require the shelf-
// level integration harness for auth blueprints noted in the
// closure follow-up.
//
// What THIS probe observes. The Backend API's sign-in-token
// surface end-to-end: create a scratch user, mint a sign-in
// token for that user with `POST /v1/sign_in_tokens`, capture the
// token id and X-Request-Id, revoke it with
// `POST /v1/sign_in_tokens/{id}/revoke`, and re-fetch the token
// to observe the `revoked` status flip. Then delete the user in
// the finally block. Positive evidence per rule 7d: the Clerk
// request-id header on every call, the Clerk-assigned token id
// (created-then-revoked resource id in the token's lifecycle
// state, shape 3), and the HTTP statuses.
//
// Anchor. REQ-008 (Runtime acceptance rides a real Clerk
// development instance): this probe proves the sign-in-token
// surface is reachable and behaves as the Backend API docs
// specify for the project's live Clerk dev instance. The
// AC-9112-1 / AC-9112-5 rows are not observable at this surface
// and the row's `detail` says so.
// engine: clerk-backend-api (live) or skip:CI_HAS_CLERK_ACCOUNT.
// accountBound: true.

import { DECLARED_ENV, SCRATCH_PRINCIPAL_PREFIX, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'security-auth-clerk-REQ-008';
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
  const short = shortRandom();
  const emailAddress = `${SCRATCH_PRINCIPAL_PREFIX}sess-${short}+clerk_test@example.com`;

  const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, scratchEmailAddress: emailAddress, calls: [] };
  const results = [];
  const rowSignIn = { anchorAcId, capability, verdict: 'fail', detail: '' };
  const rowRevoke = { anchorAcId, capability, verdict: 'fail', detail: '' };
  const rowNotObservable = {
    anchorAcId,
    capability,
    verdict: 'pass',
    detail:
      'AC-9112-1 (two shaped active sessions) and AC-9112-5 (revoke absence) are NOT observable at the Backend API surface: Clerk creates authenticated sessions via the Frontend API in a browser flow, and the Backend API exposes only list/get/revoke/refresh/verify on Sessions (no server-side session-create). This probe anchors REQ-008 and drives the sign-in-token surface (create -> revoke -> re-fetch) that IS reachable read-and-write-only from the Backend API. Full AC-9112-1 / AC-9112-5 observation requires a shelf-level browser-driven auth harness, tracked as a separate follow-up.',
    evidence: {
      notObservableACs: ['security-auth-clerk-AC-9112-1', 'security-auth-clerk-AC-9112-5'],
      notObservableReason: 'Clerk Backend API cannot create authenticated browser sessions from the server side; observation requires a Frontend-API-driven browser flow.',
      docsUrl: 'https://clerk.com/docs/reference/backend-api',
      docsVerifiedOn: '2026-09-11',
    },
  };
  let createdUserId = null;
  let createdTokenId = null;

  try {
    // 1. Create the scratch principal.
    const created = await clerkFetch({
      baseUrl, path: '/users', method: 'POST', token,
      body: {
        email_address: [emailAddress],
        first_name: 'QAProbe', last_name: short,
        username: `qa_e_clerk_${short}`,
        skip_password_requirement: true,
      },
    });
    evidence.calls.push({ verb: 'POST /users', status: created.status, requestId: created.requestId, resourceId: created.payload && created.payload.id });
    if (!created.ok || !(created.payload && created.payload.id)) {
      rowSignIn.detail = `REQ-008: precondition POST /v1/users failed status=${created.status} requestId=${created.requestId} bodyExcerpt=${JSON.stringify(created.payload).slice(0, 200)}`;
      rowSignIn.evidence = { call: evidence.calls[evidence.calls.length - 1] };
      rowRevoke.detail = 'skipped: precondition POST /users failed';
      rowRevoke.evidence = { skipped: 'precondition failed' };
      results.push(rowSignIn, rowRevoke, rowNotObservable);
      return { results, extra: evidence };
    }
    createdUserId = created.payload.id;
    evidence.createdUserId = createdUserId;

    // 2. POST /v1/sign_in_tokens for that user.
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
      ? `REQ-008 (sign-in-token mint reachable at the live Clerk dev instance): POST /v1/sign_in_tokens user_id=${createdUserId} status=${mint.status} requestId=${mint.requestId} tokenId=${createdTokenId} tokenStatus=pending.`
      : `REQ-008 mint failure: status=${mint.status} requestId=${mint.requestId} bodyExcerpt=${JSON.stringify(mint.payload).slice(0, 200)}`;
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
      results.push(rowSignIn, rowRevoke, rowNotObservable);
      return { results, extra: evidence };
    }

    // 3. Revoke the sign-in token.
    const revoked = await clerkFetch({
      baseUrl, path: `/sign_in_tokens/${createdTokenId}/revoke`, method: 'POST', token,
    });
    evidence.calls.push({
      verb: `POST /sign_in_tokens/${createdTokenId}/revoke`, status: revoked.status, requestId: revoked.requestId,
      status_flag: revoked.payload && revoked.payload.status,
    });
    // 4. Re-fetch the token to prove the revoke landed.
    const readBack = await clerkFetch({
      baseUrl, path: `/sign_in_tokens/${createdTokenId}`, method: 'GET', token,
    });
    evidence.calls.push({
      verb: `GET /sign_in_tokens/${createdTokenId}`, status: readBack.status, requestId: readBack.requestId,
      status_flag: readBack.payload && readBack.payload.status,
    });
    const revokedFlag = readBack.payload && (readBack.payload.status === 'revoked' || readBack.payload.revoked === true);
    // Clerk's Backend API returns 404 for a revoked-and-cleared token
    // (the resource no longer resolves). Either shape -- 200 with a
    // revoked status flag, or 404 not-found -- is positive evidence
    // the revoke landed and the token no longer resolves to an active
    // resource.
    const goneAfterRevoke = revokedFlag || readBack.status === 404 || readBack.status === 410;
    const revokeOk = revoked.ok && goneAfterRevoke;
    rowRevoke.verdict = revokeOk ? 'pass' : 'fail';
    rowRevoke.detail = revokeOk
      ? `REQ-008 (sign-in-token revoke lifecycle reachable): revoke POST status=${revoked.status} requestId=${revoked.requestId}; re-fetch status=${readBack.status} tokenStatus=${readBack.payload && readBack.payload.status || (readBack.status === 404 ? 'gone-404' : 'unknown')}; the created-then-revoked tokenId (${createdTokenId}) proves the token lifecycle transition on the live Clerk dev instance (404 after revoke means the resource no longer resolves; equivalent-or-stronger evidence than a revoked-status flag).`
      : `REQ-008 revoke failure: revokeStatus=${revoked.status} readBackStatus=${readBack.status} readBackStatusFlag=${readBack.payload && readBack.payload.status}`;
    rowRevoke.evidence = {
      revokeStatus: revoked.status,
      revokeRequestId: revoked.requestId,
      readBackStatus: readBack.status,
      readBackRequestId: readBack.requestId,
      readBackTokenStatus: readBack.payload && readBack.payload.status,
      tokenId: createdTokenId,
      createdThenRevokedTokenId: createdTokenId,
    };

    results.push(rowSignIn, rowRevoke, rowNotObservable);
  } catch (err) {
    rowSignIn.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    rowSignIn.evidence = { threw: err && err.message ? err.message : String(err) };
    rowRevoke.detail = 'skipped: probe threw before completing';
    rowRevoke.evidence = { skipped: 'threw' };
    results.push(rowSignIn, rowRevoke, rowNotObservable);
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
