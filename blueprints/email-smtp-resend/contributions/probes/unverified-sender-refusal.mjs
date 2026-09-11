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

// the strict-evidence contract tightening: the refusal is driven by a local catch-all
// SMTP fixture, which is a fixture-as-engine substitute for the
// Resend provider; the outcome record carries no Resend-returned
// message id or request id (providerMessageId is required to be
// null on the refusal). Both rows are de-claimed to conformanceOnly
// naming AC-4102-1 and AC-4102-2. The Resend API is not driven for
// this refusal because there is no way to elicit an unverified-sender
// refusal on Resend without an unverified sender identity available
// to the harness.
// The module anchor names the AC this probe observes as a property;
// individual rows may still de-claim (conformanceOnly) when the
// evidence shape does not carry an engine-returned identifier.
export const anchorAcId = 'AC-4102-1';
export const accountBound = false;
const AC1 = 'When the provider refuses the submission because the';
const AC2 = 'On any adapter refusal, the recipient address, subject,';
const LIM_4102_1 = `AC-4102-1: requires the refusal outcome shape returned by the Resend send interface when the provider refuses the submission. This probe drives a local catch-all SMTP fixture (fixture-as-engine), not the Resend API, and the adapter's error string is derived content rather than a Resend-returned identifier; the identifier half of the strict-evidence contract is not satisfied here.`;
const LIM_4102_2 = `AC-4102-2: requires the refusal outcome from the same Resend send interface to hold no recipient/subject/body echo across the returned error, adapter log lines, and thrown exception. This probe observes the property against the local catch-all SMTP fixture; the row is de-claimed because the observation is fixture-as-engine and carries no Resend-returned identifier.`;

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
    // AC-4102-1 refusal outcome: the strict-evidence contract requires the row to
    // assert BOTH a valid providerStatus AND providerMessageId===null
    // alongside the RESEND_SENDER_UNVERIFIED class prefix; the shape
    // is owned on TAC-401-email-smtp-resend-send-adapter.interfaces.send.
    const providerStatusValid = typeof outcome?.providerStatus === 'number' && Number.isInteger(outcome.providerStatus) && outcome.providerStatus > 0;
    const providerMessageIdIsNull = outcome?.providerMessageId === null;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_4102_1,
      verdict: outcome?.ok === false && startsWithClass && providerStatusValid && providerMessageIdIsNull && thrownMessage === null ? 'pass' : 'fail',
      detail: `observed adapter.send() against the local catch-all SMTP fixture: ok=${outcome?.ok} providerStatus=${outcome?.providerStatus} providerStatusValid=${providerStatusValid} providerMessageId=${JSON.stringify(outcome?.providerMessageId ?? null)} providerMessageIdIsNull=${providerMessageIdIsNull} error='${errorString}' startsWithClass=${startsWithClass} thrown=${thrownMessage === null ? 'null' : `'${thrownMessage}'`}. Fixture-as-engine; Resend API not called for this refusal.`,
      evidence: { ok: outcome?.ok, providerStatus: outcome?.providerStatus, providerStatusValid, providerMessageIdIsNull, errorString, startsWithClass, thrownMessage, code: outcome?.providerStatus, messageId: outcome?.providerMessageId ?? null, lastLine: emittedLines[emittedLines.length - 1] ?? null, bodyExcerpt: `refusal ok=${outcome?.ok} providerStatus=${outcome?.providerStatus} error='${errorString}'` },
    });
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_4102_2,
      verdict: cleanCall && srv.messages.length === 0 ? 'pass' : 'fail',
      detail: `observed recipient/subject/body in adapter.error=${recipientInError}/${subjectInError}/${bodyInError}; in emitted log lines=${recipientInLogs}/${subjectInLogs}/${bodyInLogs}; in thrown exception=${recipientInThrown}/${subjectInThrown}/${bodyInThrown}; server accepted messages=${srv.messages.length} (must be 0 on unverified-sender refusal). Fixture-as-engine; Resend API not called for this refusal.`,
      evidence: { recipientInError, subjectInError, bodyInError, recipientInLogs, subjectInLogs, bodyInLogs, recipientInThrown, subjectInThrown, bodyInThrown, serverAcceptedMessages: srv.messages.length, errorString, recipientInRefusal: recipientInError, lastLine: emittedLines[emittedLines.length - 1] ?? null, emittedLines, bodyExcerpt: `cleanCall=${cleanCall} serverAcceptedMessages=${srv.messages.length}` },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_SMTP_PORT'], port, adapterOutcome: outcome, emittedLogLines: emittedLines, thrownMessage } };
}
