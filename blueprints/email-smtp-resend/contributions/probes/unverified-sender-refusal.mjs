// Unverified-sender-refusal probe for email-smtp-resend.
//
// Routes an offline unverified-sender send through the fixture
// email-delivery adapter (which realises TAC-401.interfaces.send)
// with a catch-all SMTP provider seam behind it. The catch-all
// fixture is booted in unverified-sender mode, so the underlying
// SMTP reply is 550 5.7.1; the provider seam classifies that to
// RESEND_SENDER_UNVERIFIED, and the ADAPTER returns the refusal
// outcome record { ok:false, providerStatus, providerMessageId:null,
// error: 'RESEND_SENDER_UNVERIFIED: ...' }.
//
// AC-4102-1: the adapter's `error` begins with 'RESEND_SENDER_UNVERIFIED'
// (adapter refusal outcome).
// AC-4102-2: recipient, subject, textBody do not appear on the
// adapter's returned `error`, on any line emitted to the adapter's
// injected log sink during the call, or on any exception the adapter
// throws.
// Every detail line begins with the first eight words of the AC text.
import { createCatchAllSmtp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/smtp-catch-all.mjs';
import { createSendAdapter, createCatchAllSmtpProvider } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/src/send-adapter.mjs';
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
  const distinctiveRecipient = 'distinct-recipient@example.test';
  const distinctiveSubject = 'DISTINCT-SUBJECT-LINE-XYZ';
  const distinctiveBody = 'DISTINCT-BODY-BYTES-ABC123-DO-NOT-LEAK';
  const emittedLines = [];
  let outcome;
  let thrownMessage = null;
  try {
    const provider = createCatchAllSmtpProvider({ host: '127.0.0.1', port, from: 'unverified@somewhere.example' });
    const adapter = createSendAdapter({ provider, logSink: (l) => emittedLines.push(l) });
    try {
      outcome = await adapter.send({ to: distinctiveRecipient, subject: distinctiveSubject, textBody: distinctiveBody, htmlBody: null });
    } catch (e) {
      thrownMessage = e?.message ?? String(e);
    }
    const errorString = outcome?.error ?? '';
    const startsWithClass = errorString.startsWith('RESEND_SENDER_UNVERIFIED');
    const recipientInError = errorString.toLowerCase().includes(distinctiveRecipient.toLowerCase());
    const subjectInError = errorString.includes(distinctiveSubject);
    const bodyInError = errorString.includes(distinctiveBody);
    const recipientInLogs = emittedLines.some((l) => l.toLowerCase().includes(distinctiveRecipient.toLowerCase()));
    const subjectInLogs = emittedLines.some((l) => l.includes(distinctiveSubject));
    const bodyInLogs = emittedLines.some((l) => l.includes(distinctiveBody));
    const recipientInThrown = Boolean(thrownMessage && thrownMessage.toLowerCase().includes(distinctiveRecipient.toLowerCase()));
    const subjectInThrown = Boolean(thrownMessage && thrownMessage.includes(distinctiveSubject));
    const bodyInThrown = Boolean(thrownMessage && thrownMessage.includes(distinctiveBody));
    const cleanCall = !recipientInError && !subjectInError && !bodyInError && !recipientInLogs && !subjectInLogs && !bodyInLogs && !recipientInThrown && !subjectInThrown && !bodyInThrown;
    results.push({
      anchorAcId: 'AC-4102-1',
      verdict: outcome?.ok === false && startsWithClass ? 'pass' : 'fail',
      detail: `${AC1} sender is unverified  -  observed adapter.send() outcome ok=${outcome?.ok} providerStatus=${outcome?.providerStatus} error='${errorString}' startsWithClass=${startsWithClass} thrown=${thrownMessage === null ? 'null' : `'${thrownMessage}'`}. Adapter classified the fixture's 550 5.7.1 refusal to RESEND_SENDER_UNVERIFIED per TAC-401.responsibilities[3].`,
      evidence: { ok: outcome?.ok, providerStatus: outcome?.providerStatus, errorString, startsWithClass, thrownMessage, code: outcome?.providerStatus, messageId: outcome?.providerMessageId ?? null, lastLine: emittedLines[emittedLines.length - 1] ?? null },
    });
    results.push({
      anchorAcId: 'AC-4102-2',
      verdict: cleanCall && srv.messages.length === 0 ? 'pass' : 'fail',
      detail: `${AC2} subject and body do not  -  observed recipient/subject/body in adapter.error=${recipientInError}/${subjectInError}/${bodyInError}; in emitted log lines=${recipientInLogs}/${subjectInLogs}/${bodyInLogs}; in thrown exception=${recipientInThrown}/${subjectInThrown}/${bodyInThrown}; server accepted messages=${srv.messages.length} (must be 0 on unverified-sender refusal).`,
      evidence: { recipientInError, subjectInError, bodyInError, recipientInLogs, subjectInLogs, bodyInLogs, recipientInThrown, subjectInThrown, bodyInThrown, serverAcceptedMessages: srv.messages.length, errorString, recipientInRefusal: recipientInError, lastLine: emittedLines[emittedLines.length - 1] ?? null, emittedLines },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, adapterOutcome: outcome, emittedLogLines: emittedLines, thrownMessage } };
}
