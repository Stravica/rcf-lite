// Real-account magic-link send smoke. Conformance-only. The probe
// issues a real magic-link token via the fixture manager, hands the
// resulting message to the fixture's `email-delivery-adapter` whose
// default binding is Resend, and verifies the issued token locally.
// The probe observes what the adapter returned and what the fixture
// manager did; it does not observe the shipped ACs on the project's
// routes and managers, and the row records that limit alongside the
// raw adapter evidence it did capture.
//
// Positive evidence per rule 7d that is preserved on the row: the
// Resend-assigned `providerMessageId` returned by the adapter
// (created-resource id), the adapter's `providerStatus` HTTP code,
// and the `requestId` header the adapter captures. All three are
// read off the adapter's return, not off a direct vendor call.
//
// capability: principalDirectory.
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

export const anchorAcId = null;
export const capability = 'principalDirectory';
export const accountBound = true;
// AC-3110-1 binds the routes-and-managers side of the
// email-delivery-adapter contract: only the declared send method,
// only the declared arguments, only the declared fields consumed.
// This probe drives the adapter directly from a probe process, so
// it cannot observe the routes-and-managers property; the row
// records that limit next to the adapter-return evidence it did
// capture.
const DECLAIM_LIMITATION = 'security-auth-magic-link-AC-3110-1: probe drives the email-delivery-adapter directly from a probe process; the AC states the project routes and managers invoke only the declared adapter method with only the declared arguments and consume only the declared fields, which requires observing the deployed runtime through the integration harness follow-up.';

function gateResult(varName, value) {
 if (value === undefined || value === '') return { kind: 'unset', reason: varName };
 if (value !== 'true') return { kind: 'set-not-true', reason: `${varName}_SET_NOT_TRUE`, observedValue: value };
 return { kind: 'true' };
}

export default async function runProbe() {
 const gate = gateResult('CI_HAS_RESEND_ACCOUNT', process.env.CI_HAS_RESEND_ACCOUNT);
 if (gate.kind === 'unset') {
 return {
 results: [accountBoundSkippedResult(null, capability, 'CI_HAS_RESEND_ACCOUNT')],
 extra: { accountBoundSkipped: true, reason: 'CI_HAS_RESEND_ACCOUNT', envDeclared: [...DECLARED_ENV] },
 };
 }
 if (gate.kind === 'set-not-true') {
 return {
 results: [{
 anchorAcId: null, capability, verdict: 'fail',
 conformanceOnly: true, limitation: DECLAIM_LIMITATION,
 detail: `conformance-only gate: CI_HAS_RESEND_ACCOUNT is set to "${gate.observedValue}" (not the string "true"). Gate refuses this shape; set the variable to the exact string "true" to run the live branch.`,
 evidence: { gate: 'CI_HAS_RESEND_ACCOUNT', observedValue: gate.observedValue, expected: 'true' },
 }],
 extra: { gateMisconfigured: true, gate: 'CI_HAS_RESEND_ACCOUNT', envDeclared: [...DECLARED_ENV] },
 };
 }
 if (!process.env.RESEND_API_KEY) {
 return {
 results: [accountBoundSkippedResult(null, capability, 'RESEND_API_KEY')],
 extra: { accountBoundSkipped: true, reason: 'RESEND_API_KEY', envDeclared: [...DECLARED_ENV] },
 };
 }

 const baseUrl = process.env.RESEND_API_BASE_URL || RESEND_API_BASE_URL_DEFAULT;
 const from = process.env.RESEND_SANDBOX_FROM || RESEND_SANDBOX_FROM_DEFAULT;
 const to = process.env.RESEND_SANDBOX_TO || RESEND_SANDBOX_TO_DEFAULT;

 const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, from, to };
 const resultRow = { anchorAcId: null, conformanceOnly: true, limitation: DECLAIM_LIMITATION, capability, verdict: 'fail', detail: '', evidence: {} };

 try {
 const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);
 const { createResendAdapter } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'email-delivery-adapter.mjs')).href);

 const mgr = createMagicLinkManager({ ttlSeconds: 900 });
 const issued = await mgr.issue({ emailAddress: to });
 const magicLink = `https://app.example.com/auth/magic?token=${encodeURIComponent(issued.token)}`;

 const adapter = createResendAdapter({ apiKey: process.env.RESEND_API_KEY, baseUrl, from });
 const outcome = await adapter.send({
 to,
 subject: 'Sign-in link',
 textBody: `Sign in to your account by opening this magic link: ${magicLink}\n\nIf you did not request this, ignore this email.`,
 });

 const verified = await mgr.verify({ token: issued.token, emailAddress: to });

 const declaredKeys = ['ok', 'providerStatus', 'providerMessageId', 'error'];
 const outcomeKeys = Object.keys(outcome).sort();
 const extraKeys = outcomeKeys.filter((k) => !declaredKeys.includes(k));
 const missingKeys = declaredKeys.filter((k) => !(k in outcome));
 const shapeOk = extraKeys.every((k) => k === 'requestId') && missingKeys.length === 0;
 const adapterOk = outcome && outcome.ok === true && typeof outcome.providerMessageId === 'string' && outcome.providerMessageId.length > 0 && typeof outcome.providerStatus === 'number';
 const verifyOk = verified.ok;

 if (adapterOk && shapeOk && verifyOk) {
 resultRow.verdict = 'pass';
 resultRow.detail =
 `Resend adapter return observed at the probe boundary: ` +
 `outcome.ok=true providerMessageId=${outcome.providerMessageId} providerStatus=${outcome.providerStatus} ` +
 `(requestId=${outcome.requestId || 'n/a'}); fixture magic-link manager verify consumed the token single-use and returned ok=true.`;
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
 resultRow.detail = `adapter return did not match the declared shape: outcome.ok=${outcome && outcome.ok} shapeOk=${shapeOk} extraKeys=${JSON.stringify(extraKeys)} providerMessageId=${outcome && outcome.providerMessageId} providerStatus=${outcome && outcome.providerStatus} error=${outcome && outcome.error} verifyOk=${verifyOk}`;
 resultRow.evidence = { outcome, outcomeKeys, shapeOk, verifyOk };
 }
 } catch (err) {
 resultRow.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
 resultRow.evidence = { threw: err && err.message ? err.message : String(err) };
 evidence.threw = err && err.message ? err.message : String(err);
 }
 return { results: [resultRow], extra: evidence };
}
