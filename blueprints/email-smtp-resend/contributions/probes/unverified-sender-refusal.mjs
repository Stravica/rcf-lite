// Unverified-sender-refusal probe for email-smtp-resend v1.1.3.
// Boots the fixture SMTP catch-all with unverifiedSenderMode set,
// dials with a non-verified sender and asserts the server refuses
// with a 550 5.7.1 response (mapping to the blueprint's stable
// error code contract). The transcript is captured for evidence.
// The recipient must never appear in the refusal line, so the probe
// asserts the returned lastLine has no recipient substring.
//
// anchorAcId: AC-4102-1. accountBound: false.

import { createCatchAllSmtp, sendViaSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-4102-1';
export const accountBound = false;

export default async function runProbe() {
  const srv = createCatchAllSmtp();
  srv.setUnverifiedSenderMode(true);
  const { port } = await srv.listen(envPort('RCF_FIXTURE_SMTP_PORT'));
  const results = [];
  let outcome;
  try {
    const recipient = 'confidential@example.com';
    outcome = await sendViaSmtp({ host: '127.0.0.1', port, from: 'unverified@somewhere.example', to: recipient, subject: 'x', body: 'y' });
    const leakedRecipient = outcome.transcript.some((l) => l.toLowerCase().includes(recipient.toLowerCase()) && l.startsWith('5'));
    results.push({
      anchorAcId: 'AC-4102-1',
      verdict: !outcome.ok && outcome.code === 550 && !leakedRecipient ? 'pass' : 'fail',
      detail: `refusal code=${outcome.code}; lastLine='${outcome.lastLine}'; recipient in refusal=${leakedRecipient}`,
      evidence: { code: outcome.code, lastLine: outcome.lastLine, recipientInRefusal: leakedRecipient },
    });
    results.push({
      anchorAcId: 'AC-4102-2',
      verdict: srv.messages.length === 0 ? 'pass' : 'fail',
      detail: `no message accepted; server messages=${srv.messages.length}`,
      evidence: { serverAcceptedMessages: srv.messages.length },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, transcript: outcome?.transcript } };
}
