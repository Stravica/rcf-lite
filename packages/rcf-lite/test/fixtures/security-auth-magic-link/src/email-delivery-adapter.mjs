// TAC-504 email-delivery-adapter shape for the security-auth-
// magic-link fixture. Implements the narrow contract AC-3110-1
// names: `send({ to, subject, textBody, htmlBody }) -> { ok,
// providerStatus, providerMessageId, error }`. The routes and
// managers speak only the adapter's shape; provider names,
// credentials and endpoints never appear at the call sites.
//
// The fixture ships two bindings:
//
// - `createStubAdapter()` -- the AC-3110-3 in-memory stub whose
// `send` resolves `{ ok: true, providerStatus: 200,
// providerMessageId: 'stub' }` and appends the call args to an
// internal `.calls` array so the test harness can enumerate them.
//
// - `createResendAdapter({ apiKey, baseUrl })` -- binds the adapter
// to Resend's HTTP API (POST /emails per
// https://resend.com/docs/api-reference/emails/send-email
// verifiedOn 2026-09-11). Every outgoing call is a `send` on the
// adapter interface; the adapter carries the vendor-specific
// HTTP layer so the auth code path stays vendor-agnostic. The
// returned shape is normalised to
// `{ ok, providerStatus, providerMessageId, error, requestId }`
// with the HTTP status stashed on `providerStatus`, the vendor
// response id on `providerMessageId`, and the `x-request-id`
// header (or `cf-ray` fallback) on `requestId`.

const RESEND_API_BASE_URL_DEFAULT = 'https://api.resend.com';

function pickRequestId(headers) {
 return headers.get('x-request-id') || headers.get('cf-ray') || null;
}

export function createStubAdapter() {
 const calls = [];
 return {
 kind: 'stub',
 async send({ to, subject, textBody, htmlBody }) {
 calls.push({ to, subject, textBody, htmlBody });
 return { ok: true, providerStatus: 200, providerMessageId: 'stub' };
 },
 get calls() { return calls.slice(); },
 };
}

export function createResendAdapter({ apiKey, baseUrl = RESEND_API_BASE_URL_DEFAULT, from } = {}) {
 if (!apiKey) throw new Error('createResendAdapter: apiKey required');
 if (!from) throw new Error('createResendAdapter: from address required');
 return {
 kind: 'resend',
 async send({ to, subject, textBody, htmlBody }) {
 if (!to || !subject) {
 return { ok: false, providerStatus: 0, providerMessageId: null, error: 'to and subject required' };
 }
 const body = { from, to, subject };
 if (textBody !== undefined) body.text = textBody;
 if (htmlBody !== undefined) body.html = htmlBody;
 let res;
 try {
 res = await fetch(`${baseUrl}/emails`, {
 method: 'POST',
 headers: {
 Authorization: `Bearer ${apiKey}`,
 'Content-Type': 'application/json',
 Accept: 'application/json',
 },
 body: JSON.stringify(body),
 });
 } catch (err) {
 return {
 ok: false,
 providerStatus: 0,
 providerMessageId: null,
 error: `network error: ${err && err.message ? err.message : String(err)}`,
 };
 }
 const requestId = pickRequestId(res.headers);
 const text = await res.text();
 let payload = null;
 try { payload = JSON.parse(text); } catch {}
 const providerMessageId = payload && typeof payload.id === 'string' ? payload.id : null;
 if (!res.ok || !providerMessageId) {
 return {
 ok: false,
 providerStatus: res.status,
 providerMessageId,
 error: payload && (payload.message || payload.error) ? String(payload.message || payload.error) : `HTTP ${res.status}`,
 requestId,
 };
 }
 return {
 ok: true,
 providerStatus: res.status,
 providerMessageId,
 requestId,
 };
 },
 };
}
