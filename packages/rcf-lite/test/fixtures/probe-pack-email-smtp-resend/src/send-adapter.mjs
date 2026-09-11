// Fixture email-delivery adapter for probe-pack-email-smtp-resend.
//
// Realises TAC-401-email-smtp-resend-send-adapter.interfaces.send:
//   send({ to, subject, textBody, htmlBody }) ->
//     Promise<{ ok, providerStatus, providerMessageId, error }>
//
// The fixture ships two backing shapes selected via the `provider`
// injection:
//   - 'resendRest': dials Resend's REST API (a real vendor call). Used
//     by the real-account probe: the adapter is the module the probe
//     observes; Resend is the substrate BEHIND the adapter, per master
//     brief Addendum rule 2.
//   - 'catchAllSmtp': dials a local SMTP catch-all fixture; used by
//     unit-shape probes without a live account.
//
// Classification maps the four terminal-class codes named on
// TAC-401.responsibilities[3] onto the `error` string. The adapter
// never places the recipient, subject, or textBody into `error`.

export function createSendAdapter({ provider }) {
  return {
    async send({ to, subject, textBody, htmlBody }) {
      const req = { to, subject, textBody, htmlBody };
      const outcome = await provider.dispatch(req);
      // Successful path: ok=true, providerStatus=HTTP status, providerMessageId=id.
      if (outcome.kind === 'success') {
        return { ok: true, providerStatus: outcome.providerStatus, providerMessageId: outcome.providerMessageId, error: null };
      }
      // Refusal path: ok=false, error prefixed with the class code.
      // The recipient/subject/body are never placed on error.
      const code = outcome.classCode || 'RESEND_TRANSPORT_ERROR';
      return { ok: false, providerStatus: outcome.providerStatus ?? null, providerMessageId: null, error: `${code}: provider refused the submission (see structured logs).` };
    },
  };
}

// A provider seam that dials Resend's REST API with the caller-
// supplied credential and returns the classified outcome.
export function createResendRestProvider({ apiKey, from }) {
  return {
    async dispatch({ to, subject, textBody, htmlBody }) {
      const body = JSON.stringify({ from, to, subject, text: textBody, html: htmlBody });
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body });
      const json = await res.json().catch(() => ({}));
      const providerStatus = res.status;
      const providerRequestId = res.headers.get('x-request-id') || res.headers.get('resend-request-id') || null;
      const id = json.id || json.data?.id || null;
      if (res.status === 200 && id) {
        return { kind: 'success', providerStatus, providerMessageId: id, providerRequestId };
      }
      if (res.status === 429) {
        return { kind: 'refusal', classCode: 'RESEND_RATE_LIMITED', providerStatus, providerRequestId };
      }
      if (res.status === 422 || res.status === 403) {
        return { kind: 'refusal', classCode: 'RESEND_SENDER_UNVERIFIED', providerStatus, providerRequestId };
      }
      return { kind: 'refusal', classCode: 'RESEND_TRANSPORT_ERROR', providerStatus, providerRequestId };
    },
  };
}
