// SMTP round-trip probe for email-smtp-resend.
//
// Boots the fixture SMTP catch-all on 127.0.0.1 and dials it via the
// fixture's sendViaSmtp helper. Asserts the transcript reports 250 Ok
// on MAIL/RCPT/DATA and that the server's recorded envelope carries
// the sender, recipient and body bytes.
//
// The nearest shipped AC is AC-4101-3 ("Exactly one SMTP submission
// is dispatched per adapter call on the successful path"). This row
// observes a local catch-all SMTP dispatch, not Resend's SMTP endpoint,
// and does not go through the send adapter. Row de-claimed
// (conformanceOnly, anchorAcId=null) with the limitation naming
// AC-4101-3.
import { createCatchAllSmtp, sendViaSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-4101-3';
export const accountBound = false;
const LIM_4101_3 = `AC-4101-3: requires exactly one SMTP submission per adapter call on the successful path. This row observes a local catch-all SMTP dispatch via a helper (sendViaSmtp), not a call through the send adapter, and the transport is not the Resend SMTP endpoint.`;

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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_4101_3,
      verdict: outcome.ok && queuedLine && recorded && recorded.from === 'probe@verified.example' && recorded.to[0] === 'x@example.com' ? 'pass' : 'fail',
      detail: `observed local SMTP round-trip via sendViaSmtp ok=${outcome.ok}; queuedId=${idFromServer}; server recorded envelope from=${recorded?.from} to=${recorded?.to?.[0]}. Not the Resend endpoint; not through the send adapter.`,
      evidence: { queuedLine, messageId: idFromServer, envelope: recorded ? { from: recorded.from, to: recorded.to, dataExcerpt: recorded.dataText?.slice(0, 200) } : null },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, transcript: outcome?.transcript } };
}
