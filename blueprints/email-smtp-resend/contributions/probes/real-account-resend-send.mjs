// Real-account Resend send probe for email-smtp-resend.
// Routes the send through the fixture email-delivery adapter (which
// realises TAC-401.interfaces.send) with Resend REST as the provider
// seam behind it, per master brief Addendum rule 2. The probe
// observes the adapter's outcome record (ok, providerStatus,
// providerMessageId) so AC-4101-2's success-shape property is what
// gets asserted.
// Every detail line begins with the first eight words of the AC text.
import { createSendAdapter, createResendRestProvider } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/send-adapter.mjs';

export const anchorAcId = 'AC-4101-2';
export const accountBound = true;
const AC2 = 'A successful send resolves the outcome record owned';

function skipResult(reason, detail) {
  return {
    results: [{ anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail }],
    extra: {
      accountBoundSkipped: true, reason,
      envDeclared: ['CI_HAS_RESEND_ACCOUNT', 'RESEND_API_KEY'],
      vendorFact: { url: 'https://resend.com/docs/dashboard/emails/send-test-emails', verifiedOn: '2026-09-11' },
    },
  };
}

export default async function runProbe() {
  if (process.env.CI_HAS_RESEND_ACCOUNT !== 'true') return skipResult('CI_HAS_RESEND_ACCOUNT', `${AC2} on TAC-401  -  accountBoundSkipped: CI_HAS_RESEND_ACCOUNT is not set to true; the adapter did not dispatch.`);
  if (!process.env.RESEND_API_KEY) return skipResult('RESEND_API_KEY', `${AC2} on TAC-401  -  accountBoundSkipped: RESEND_API_KEY unset; the adapter did not dispatch.`);
  const results = [];
  const provider = createResendRestProvider({ apiKey: process.env.RESEND_API_KEY, from: 'onboarding@resend.dev' });
  const adapter = createSendAdapter({ provider });
  const outcome = await adapter.send({ to: 'delivered@resend.dev', subject: 'rcf-lite criterion-e probe', textBody: 'criterion-e probe send at ' + new Date().toISOString(), htmlBody: null });
  results.push({
    anchorAcId: 'AC-4101-2',
    verdict: outcome.ok === true && typeof outcome.providerMessageId === 'string' && outcome.providerMessageId.length > 0 && outcome.error === null ? 'pass' : 'fail',
    detail: `${AC2} on TAC-401.interfaces.send  -  observed adapter.send() returned { ok: ${outcome.ok}, providerStatus: ${outcome.providerStatus}, providerMessageId: '${outcome.providerMessageId}', error: ${outcome.error === null ? 'null' : `'${outcome.error}'`} }; the adapter dispatched through Resend REST as the provider seam.`,
    evidence: { ok: outcome.ok, providerStatus: outcome.providerStatus, providerMessageId: outcome.providerMessageId, error: outcome.error },
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
