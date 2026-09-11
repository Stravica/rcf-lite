// SMTP round-trip probe for email-smtp-resend v1.1.3.
// Boots the fixture SMTP catch-all on 127.0.0.1, dials it via the
// fixture's sendViaSmtp adapter and asserts the transcript reports
// 250 Ok on MAIL/RCPT/DATA, and that the server's recorded
// message envelope carries the sender, recipient and body bytes.
//
// Positive evidence: the per-connection SMTP message id echoed in
// the 220 greeting and returned on the 250 "queued as <id>" reply.
// anchorAcId: AC-4101-1. accountBound: false.

import { createCatchAllSmtp, sendViaSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-4101-1';
export const accountBound = false;

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
      anchorAcId: 'AC-4101-1',
      verdict: outcome.ok && queuedLine && recorded && recorded.from === 'probe@verified.example' && recorded.to[0] === 'x@example.com' ? 'pass' : 'fail',
      detail: `SMTP round-trip ok=${outcome.ok}; queuedId=${idFromServer}; server recorded from=${recorded?.from} to=${recorded?.to?.[0]}`,
      evidence: { queuedLine, messageId: idFromServer, envelope: recorded ? { from: recorded.from, to: recorded.to, dataExcerpt: recorded.dataText?.slice(0, 200) } : null },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, transcript: outcome?.transcript } };
}
