// Real-account magic-link send probe. Uses the Resend HTTP API
// (https://api.resend.com/emails, docs
// https://resend.com/docs/api-reference/emails/send-email verifiedOn
// 2026-09-11) to send a magic-link email to Resend's documented
// sandbox recipient `delivered@resend.dev` (per
// https://resend.com/docs/dashboard/emails/send-test-emails
// verifiedOn 2026-09-11) from the vendor's sandbox sender
// `onboarding@resend.dev`. The sandbox recipient guarantees Resend
// routes the message through its accepted-and-simulated path
// without reaching a real mailbox.
//
// Positive evidence recorded per rule 7d: the Resend-assigned email
// id returned in the response body (`{ id: "..." }` per the API
// reference), the HTTP status code, and the request id header
// Resend returns on every response. The email id is the created-
// resource id in rule 7d shape 3.
//
// Also drives the fixture magic-link manager to issue the actual
// token that lands in the email body, then verifies it locally so
// the end-to-end shape (issue + send + verify) is exercised in one
// probe run.
//
// capability: principalDirectory (magic-link send + verify is the
//   round-trip verb).
// anchorAcId: security-auth-magic-link-AC-3103-1.
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

export const anchorAcId = 'security-auth-magic-link-AC-3103-1';
export const capability = 'principalDirectory';
export const accountBound = true;

function pickRequestId(headers) {
  return headers.get('x-request-id') || headers.get('cf-ray') || null;
}

export default async function runProbe() {
  if (process.env.CI_HAS_RESEND_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, capability, 'CI_HAS_RESEND_ACCOUNT')],
      extra: { accountBoundSkipped: true, reason: 'CI_HAS_RESEND_ACCOUNT', envDeclared: [...DECLARED_ENV] },
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

  const evidence = { envDeclared: [...DECLARED_ENV], baseUrl, from, to, calls: [] };
  const resultRow = { anchorAcId, capability, verdict: 'fail', detail: '' };

  try {
    // Local: issue a real magic-link token for the recipient.
    const { createMagicLinkManager } = await import(pathToFileURL(resolve(FIXTURE_SRC, 'magic-link-manager.mjs')).href);
    const mgr = createMagicLinkManager({ ttlSeconds: 900 });
    const issued = await mgr.issue({ emailAddress: to });
    const magicLink = `https://app.example.com/auth/magic?token=${encodeURIComponent(issued.token)}`;

    // Send the email via Resend.
    const res = await fetch(`${baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: 'QA-e-magic-link-send probe',
        text: `Sign in to your account by opening this magic link: ${magicLink}\n\nIf you did not request this, ignore this email.`,
      }),
    });
    const requestId = pickRequestId(res.headers);
    const text = await res.text();
    let payload = null; try { payload = JSON.parse(text); } catch {}
    evidence.calls.push({ verb: 'POST /emails', status: res.status, requestId, resourceId: payload && payload.id });

    // Verify the token locally to prove the end-to-end shape.
    const verified = await mgr.verify({ token: issued.token, emailAddress: to });

    const emailIdOk = res.ok && payload && typeof payload.id === 'string' && payload.id.length > 0;
    const verifyOk = verified.ok;

    if (emailIdOk && verifyOk) {
      resultRow.verdict = 'pass';
      resultRow.detail =
        `real-account magic-link: local issue produced token (${issued.token.length}c base64url); ` +
        `Resend POST /emails from=${from} to=${to} status=${res.status} requestId=${requestId} emailId=${payload.id}; ` +
        `local verify consumed the token (single-use) and returned ok=true.`;
      evidence.emailId = payload.id;
      evidence.status = res.status;
      evidence.requestId = requestId;
      evidence.verifyOk = true;
    } else {
      resultRow.detail = `send or verify failed: sendOk=${res.ok} status=${res.status} requestId=${requestId} bodyExcerpt=${text.slice(0, 200)} verifyOk=${verifyOk}`;
    }
  } catch (err) {
    resultRow.detail = `probe threw: ${err && err.message ? err.message : String(err)}`;
    evidence.threw = err && err.message ? err.message : String(err);
  }
  return { results: [resultRow], extra: evidence };
}
