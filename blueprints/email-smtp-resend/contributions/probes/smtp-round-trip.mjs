// SMTP round-trip probe for email-smtp-resend.
// Boots the fixture SMTP catch-all on 127.0.0.1 and dials it via the
// fixture's sendViaSmtp helper. Asserts the transcript reports 250 Ok
// on MAIL/RCPT/DATA, and that the server's recorded envelope carries
// the sender, recipient and body bytes.
// Anchor: REQ-002-email-smtp-resend (Transport is Resend's SMTP
// endpoint; the fixture substitutes for the vendor endpoint in the
// local branch). Every detail line begins with the first eight words
// of the REQ title.
import { createCatchAllSmtp, sendViaSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'REQ-002-email-smtp-resend';
export const accountBound = false;
const REQ2 = "Transport is Resend's SMTP endpoint, credentialed from placeholder-referenced";

export default async function runProbe() {
  const srv = createCatchAllSmtp();
  const { port } = await srv.listen(envPort('RCF_FIXTURE_SMTP_PORT'));
  const results = [];
  let outcome;
  try {
    outcome = await sendViaSmtp({ host: '127.0.0.1', port, from: 'probe@verified.example', to: 'x@example.com', subject: 'probe', body: 'hi\n' });
    const queuedLine = outcome.transcript.find((l) => l.startsWith('250') && l.includes('queued as '));
    const idFromServer = queuedLine ? queuedLine.split('queued as ')[1] : null;
    const recorded = srv.messages[0];
    results.push({
      anchorAcId: 'REQ-002-email-smtp-resend',
      verdict: outcome.ok && queuedLine && recorded && recorded.from === 'probe@verified.example' && recorded.to[0] === 'x@example.com' ? 'pass' : 'fail',
      detail: `${REQ2} secrets  -  observed SMTP round-trip ok=${outcome.ok}; queuedId=${idFromServer}; server recorded envelope from=${recorded?.from} to=${recorded?.to?.[0]}.`,
      evidence: { queuedLine, messageId: idFromServer, envelope: recorded ? { from: recorded.from, to: recorded.to, dataExcerpt: recorded.dataText?.slice(0, 200) } : null },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, transcript: outcome?.transcript } };
}
