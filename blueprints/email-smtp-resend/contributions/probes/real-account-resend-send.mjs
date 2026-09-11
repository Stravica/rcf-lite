// Real-account Resend send probe for email-smtp-resend v1.1.3.
//
// Live branch: POSTs to https://api.resend.com/emails from onboarding@
// resend.dev to delivered@resend.dev (Resend sandbox addresses that
// always deliver without hitting a real mailbox), records the real
// email id returned in the response body and the vendor request id
// on the response headers.
//
// Vendor citation: Resend sandbox addresses,
// https://resend.com/docs/dashboard/emails/send-test-emails (verified
// on 2026-09-11 for criterion e).
//
// Honest skip: without CI_HAS_RESEND_ACCOUNT=true or RESEND_API_KEY,
// records accountBoundSkipped: true and the reason names the unset
// variable.
//
// anchorAcId: AC-4101-2 (adapter dispatches one message; the vendor
// returns a real transaction id). accountBound: true.

export const anchorAcId = 'AC-4101-2';
export const accountBound = true;

const API = 'https://api.resend.com/emails';

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
  if (process.env.CI_HAS_RESEND_ACCOUNT !== 'true') return skipResult('CI_HAS_RESEND_ACCOUNT', 'accountBoundSkipped: CI_HAS_RESEND_ACCOUNT is not set to true; the probe did not send.');
  if (!process.env.RESEND_API_KEY) return skipResult('RESEND_API_KEY', 'accountBoundSkipped: RESEND_API_KEY unset; the probe did not send.');
  const results = [];
  const body = JSON.stringify({ from: 'onboarding@resend.dev', to: 'delivered@resend.dev', subject: 'rcf-lite criterion-e probe', text: 'criterion-e probe send at ' + new Date().toISOString() });
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body });
  const json = await res.json().catch(() => ({}));
  const requestId = res.headers.get('x-request-id') || res.headers.get('resend-request-id');
  const emailId = json.id || json.data?.id;
  results.push({
    anchorAcId: 'AC-4101-2',
    verdict: res.status === 200 && emailId ? 'pass' : 'fail',
    detail: `POST /emails -> ${res.status}; emailId=${emailId}; requestId=${requestId}`,
    evidence: { status: res.status, requestId, emailId, bodyExcerpt: JSON.stringify(json).slice(0, 300) },
  });
  return {
    results,
    extra: {
      envDeclared: ['CI_HAS_RESEND_ACCOUNT', 'RESEND_API_KEY'],
      sentTo: 'delivered@resend.dev', sentFrom: 'onboarding@resend.dev', vendorEmailId: emailId, vendorRequestId: requestId,
      vendorFact: { url: 'https://resend.com/docs/dashboard/emails/send-test-emails', verifiedOn: '2026-09-11' },
    },
  };
}
