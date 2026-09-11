// Real-account Resend send probe for email-smtp-resend.
//
// Routes the send through the fixture email-delivery adapter (which
// realises TAC-401.interfaces.send) with Resend REST as the provider
// seam behind it. The probe observes the adapter's outcome record
// (ok, providerStatus, providerMessageId) and asserts AC-4101-2's
// success shape, including that providerStatus is a positive integer
// in the accepted 200-299 range (per TAC-401's accepted status
// contract) alongside a non-empty providerMessageId.
import { createSendAdapter, createResendRestProvider } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/send-adapter.mjs';

export const anchorAcId = 'AC-4101-2';
export const accountBound = true;
const AC2 = 'A successful send resolves the outcome record owned';

function skipResult(reason, detail) {
  return {
    results: [{ anchorAcId: null, accountBoundSkipped: true, reason, verdict: 'pass', detail, evidence: { reason, declared: 'gate variable' } }],
    extra: {
      accountBoundSkipped: true, reason,
      envDeclared: ['CI_HAS_RESEND_ACCOUNT', 'RESEND_API_KEY'],
      vendorFact: { url: 'https://resend.com/docs/dashboard/emails/send-test-emails', verifiedOn: '2026-09-11' },
    },
  };
}

export default async function runProbe() {
  if (process.env.CI_HAS_RESEND_ACCOUNT !== 'true') return skipResult('CI_HAS_RESEND_ACCOUNT', `accountBoundSkipped: CI_HAS_RESEND_ACCOUNT is not set to true; the adapter did not dispatch.`);
  if (!process.env.RESEND_API_KEY) return skipResult('RESEND_API_KEY', `accountBoundSkipped: RESEND_API_KEY unset; the adapter did not dispatch.`);
  const results = [];
  const provider = createResendRestProvider({ apiKey: process.env.RESEND_API_KEY, from: 'onboarding@resend.dev' });
  const adapter = createSendAdapter({ provider });
  const outcome = await adapter.send({ to: 'delivered@resend.dev', subject: 'rcf-lite criterion e probe', textBody: 'criterion e probe send at ' + new Date().toISOString(), htmlBody: null });
  const statusIsAccepted = typeof outcome.providerStatus === 'number' && Number.isInteger(outcome.providerStatus) && outcome.providerStatus >= 200 && outcome.providerStatus < 300;
  results.push({
    anchorAcId: 'AC-4101-2',
    verdict: outcome.ok === true && statusIsAccepted && typeof outcome.providerMessageId === 'string' && outcome.providerMessageId.length > 0 && outcome.error === null ? 'pass' : 'fail',
    detail: `${AC2} on TAC-401.interfaces.send  -  observed adapter.send() returned { ok: ${outcome.ok}, providerStatus: ${outcome.providerStatus}, providerMessageId: '${outcome.providerMessageId}', error: ${outcome.error === null ? 'null' : `'${outcome.error}'`} }; providerStatus is an integer in the accepted 200-299 range: ${statusIsAccepted}; the adapter dispatched through Resend REST as the provider seam.`,
    evidence: { ok: outcome.ok, providerStatus: outcome.providerStatus, providerMessageId: outcome.providerMessageId, error: outcome.error, statusIsAccepted },
  });
  return {
    results,
    extra: {
      envDeclared: ['CI_HAS_RESEND_ACCOUNT', 'RESEND_API_KEY'],
      sentTo: 'delivered@resend.dev', sentFrom: 'onboarding@resend.dev',
      adapterOutcome: outcome,
      vendorFact: { url: 'https://resend.com/docs/dashboard/emails/send-test-emails', verifiedOn: '2026-09-11' },
    },
  };
}
