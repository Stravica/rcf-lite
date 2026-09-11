// Unverified-sender-refusal probe for email-smtp-resend.
// Boots the fixture SMTP catch-all in unverified-sender mode, dials
// with a non-verified sender and asserts the server refuses with a
// 550 5.7.1 line (which the adapter classification maps to
// RESEND_SENDER_UNVERIFIED per TAC-401). The recipient must never
// appear in the refusal line, so the probe asserts the returned
// lastLine has no recipient substring.
// Anchors AC-4102-1 (unverified refusal classification) and
// AC-4102-2 (no recipient/subject/body leak). Every detail line
// begins with the first eight words of the AC text.
import { createCatchAllSmtp, sendViaSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-4102-1';
export const accountBound = false;
const AC1 = 'When the provider refuses the submission because the';
const AC2 = 'On any adapter refusal, the recipient address, subject,';

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
      verdict: !outcome.ok && outcome.code === 550 && /^550\s+5\.7\.1\b/.test(outcome.lastLine || '') ? 'pass' : 'fail',
      detail: `${AC1} sender is unverified  -  observed refusal code=${outcome.code}; contract '550 5.7.1' matched=${/^550\s+5\.7\.1\b/.test(outcome.lastLine || '')}; lastLine='${outcome.lastLine}' (adapter classification maps this to RESEND_SENDER_UNVERIFIED per TAC-401).`,
      evidence: { code: outcome.code, lastLine: outcome.lastLine },
    });
    results.push({
      anchorAcId: 'AC-4102-2',
      verdict: !leakedRecipient && srv.messages.length === 0 ? 'pass' : 'fail',
      detail: `${AC2} subject and body do not  -  observed recipient present in refusal lines=${leakedRecipient}; server accepted messages=${srv.messages.length} (must be 0 on unverified-sender refusal).`,
      evidence: { recipientInRefusal: leakedRecipient, serverAcceptedMessages: srv.messages.length, lastLine: outcome.lastLine },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, transcript: outcome?.transcript } };
}
