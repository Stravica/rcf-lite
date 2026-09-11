// Real-account magic-link send probe. Exercises AC-3110-1 (the
// email-delivery-adapter contract) end-to-end against a real Resend
// binding. The probe issues a real magic-link token via the fixture
// manager, constructs the sign-in URL, and hands the message to the
// fixture's `email-delivery-adapter` whose default binding is Resend.
// The probe inspects the adapter's returned shape (`{ ok,
// providerStatus, providerMessageId, error }`) -- the ONLY surface the
// magic-link routes and managers talk to per AC-3110-1 -- and then
// verifies the token locally so the end-to-end shape (issue + send-
// through-adapter + verify) is exercised in a single run.
//
// Positive evidence per rule 7d: the Resend-assigned `providerMessageId`
// returned by the adapter (created-resource id), the adapter's
// `providerStatus` HTTP code, and the `requestId` header the adapter
// captures. All three are read off the adapter's return, not off a
// direct vendor call -- the AC's surface is the adapter, not Resend.
//
// capability: principalDirectory.
// Anchor: AC-3110-1 (email-delivery-adapter's send returns
// `{ ok, providerStatus, providerMessageId, error }`; the routes
// and managers invoke ONLY the declared method with ONLY the
// declared arguments and consume ONLY the declared fields).
// engine: resend (live) or skip:CI_HAS_RESEND_ACCOUNT.
// accountBound: true.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
 DECLARED_ENV, accountBoundSkippedResult,
 RESEND_SANDBOX_FROM_DEFAULT, RESEND_SANDBOX_TO_DEFAULT, RESEND_API_BASE_URL_DEFAULT,
} from './probe-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-magic-link', 'src');

export const anchorAcId = 'security-auth-magic-link-AC-3110-1';
export const capability = 'principalDirectory';
export const accountBound = true;

function gateResult(varName, value) {
 if (value === undefined || value === '') return { kind: 'unset', reason: varName };
 if (value !== 'true') return { kind: 'set-not-true', reason: `${varName}_SET_NOT_TRUE`, observedValue: value };
 return { kind: 'true' };
}

export default async function runProbe() {
 const gate = gateResult('CI_HAS_RESEND_ACCOUNT', process.env.CI_HAS_RESEND_ACCOUNT);
 if (gate.kind === 'unset') {
 return {
 results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_RESEND_ACCOUNT')],
 extra: { accountBoundSkipped: true, reason: 'CI_HAS_RESEND_ACCOUNT', envDeclared: [...DECLARED_ENV] },
 };
 }
 if (gate.kind === 'set-not-true') {
 return {
 results: [{
 anchorAcId, capability, verdict: 'fail',
 detail: `AC-3110-1: CI_HAS_RESEND_ACCOUNT is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
 evidence: { gate: 'CI_HAS_RESEND_ACCOUNT', observedValue: gate.observedValue, expected: 'true' },
 }],
 extra: { gateMisconfigured: true, gate: 'CI_HAS_RESEND_ACCOUNT', envDeclared: [...DECLARED_ENV] },
 };
 }
 if (!process.env.RESEND_API_KEY) {
 return {
 results: [accountBoundSkippedResult(anchorAcId, capability, 'RESEND_API_KEY')],
 extra: { accountBoundSkipped: true, reason: 'RESEND_API_KEY', envDeclared: [...DECLARED_ENV] },
 };
 }

 const baseUrl = process.env.RESEND_API_BASE_URL || RESEND_API_BASE_URL_DEFAULT;
 const from = process.env.RESEND_SANDBOX_FROM || RESEND_SANDBOX_FROM_DEFAULT;
 const to = process.env.RESEND_SANDBOX_TO || RESEND_SANDBOX_TO_DEFAULT;

 const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, from, to };
 const resultRow = { anchorAcId, capability, verdict: 'fail', detail: '', evidence: {} };

 try {
 const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);
 const { createResendAdapter } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'email-delivery-adapter.mjs')).href);

 // 1. Local manager mints a real single-use token.
 const mgr = createMagicLinkManager({ ttlSeconds: 900 });
 const issued = await mgr.issue({ emailAddress: to });
 const magicLink = `https://app.example.com/auth/magic?token=${encodeURIComponent(issued.token)}`;

 // 2. Send through the adapter (Resend binding). The probe calls
 // ONLY the adapter's declared method with ONLY the declared
 // arguments -- no direct vendor call.
 const adapter = createResendAdapter({ apiKey: process.env.RESEND_API_KEY, baseUrl, from });
 const outcome = await adapter.send({
 to,
 subject: 'QA-e-magic-link-send probe',
 textBody: `Sign in to your account by opening this magic link: ${magicLink}\n\nIf you did not request this, ignore this email.`,
 });

 // 3. Local verify -- proves the end-to-end shape (issue + send-through-adapter + verify).
 const verified = await mgr.verify({ token: issued.token, emailAddress: to });

 // AC-3110-1 shape observation: the outcome has exactly the
 // declared field surface (`ok`, `providerStatus`,
 // `providerMessageId`, `error`) and the ok path returns a
 // provider-assigned message id.
 const declaredKeys = ['ok', 'providerStatus', 'providerMessageId', 'error'];
 const outcomeKeys = Object.keys(outcome).sort();
 const extraKeys = outcomeKeys.filter((k) => !declaredKeys.includes(k));
 // `requestId` is allowed as a diagnostic side-channel on the
 // adapter's returned shape (documented in the adapter comment);
 // any OTHER extra field would be a shape violation.
 const shapeOk = extraKeys.every((k) => k === 'requestId');
 const adapterOk = outcome && outcome.ok === true && typeof outcome.providerMessageId === 'string' && outcome.providerMessageId.length > 0 && typeof outcome.providerStatus === 'number';
 const verifyOk = verified.ok;

 if (adapterOk && shapeOk && verifyOk) {
 resultRow.verdict = 'pass';
 resultRow.detail =
 `AC-3110-1 (adapter.send returns { ok, providerStatus, providerMessageId, error } shape end-to-end via the shipped adapter): ` +
 `outcome.ok=true providerMessageId=${outcome.providerMessageId} providerStatus=${outcome.providerStatus} ` +
 `(requestId=${outcome.requestId || 'n/a'}); local verify consumed the token single-use and returned ok=true.`;
 resultRow.evidence = {
 providerMessageId: outcome.providerMessageId,
 providerStatus: outcome.providerStatus,
 requestId: outcome.requestId || null,
 adapterKind: adapter.kind,
 outcomeKeys,
 outcomeShapeOk: shapeOk,
 from, to,
 localVerifyOk: true,
 localTokenLen: issued.token.length,
 };
 Object.assign(evidence, {
 providerMessageId: outcome.providerMessageId,
 providerStatus: outcome.providerStatus,
 requestId: outcome.requestId || null,
 });
 } else {
 resultRow.detail = `AC-3110-1 failure: outcome.ok=${outcome && outcome.ok} shapeOk=${shapeOk} extraKeys=${JSON.stringify(extraKeys)} providerMessageId=${outcome && outcome.providerMessageId} providerStatus=${outcome && outcome.providerStatus} error=${outcome && outcome.error} verifyOk=${verifyOk}`;
 resultRow.evidence = { outcome, outcomeKeys, shapeOk, verifyOk };
 }
 } catch (err) {
 resultRow.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
 resultRow.evidence = { threw: err && err.message ? err.message : String(err) };
 evidence.threw = err && err.message ? err.message : String(err);
 }
 return { results: [resultRow], extra: evidence };
}
