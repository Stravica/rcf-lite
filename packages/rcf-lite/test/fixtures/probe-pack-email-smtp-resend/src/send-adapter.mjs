// Fixture email-delivery adapter for probe-pack-email-smtp-resend.
//
// Realises TAC-401-email-smtp-resend-send-adapter.interfaces.send:
//   send({ to, subject, textBody, htmlBody }) ->
//     Promise<{ ok, providerStatus, providerMessageId, error }>
//
// The fixture ships three backing shapes selected via the `provider`
// injection:
//   - 'resendRest': dials Resend's REST API (a real vendor call). Used
//     by the real-account probe: the adapter is the module the probe
//     observes; Resend is the substrate BEHIND the adapter, per master
//     send adapter contract.
//   - 'catchAllSmtp': dials a local SMTP catch-all fixture; used by
//     the offline round-trip probe.
//   - 'catchAllSmtpUnverifiedSender': dials the local SMTP catch-all
//     fixture in unverified-sender mode and classifies its 550 5.7.1
//     refusal to RESEND_SENDER_UNVERIFIED for the offline refusal probe.
//
// Classification maps the four terminal-class codes named on
// TAC-401.responsibilities[3] onto the `error` string. The adapter
// never places the recipient, subject, or textBody into `error`,
// into any line it writes to the injected logSink, or into any
// exception it throws.

export function createSendAdapter({ provider, logSink }) {
  const emittedLogLines = [];
  const emit = typeof logSink === 'function' ? logSink : (line) => emittedLogLines.push(line);
  return {
    logLines: emittedLogLines,
    async send({ to, subject, textBody, htmlBody }) {
      const req = { to, subject, textBody, htmlBody };
      let outcome;
      try {
        outcome = await provider.dispatch(req);
      } catch (e) {
        // Rewrap so the recipient/subject/body never appear on the
        // thrown exception message. e.message here is provider-owned;
        // classify to RESEND_TRANSPORT_ERROR and elide payload data.
        const safe = new Error('RESEND_TRANSPORT_ERROR: provider threw (see structured logs).');
        safe.code = 'RESEND_TRANSPORT_ERROR';
        emit('send-adapter: provider threw; classified RESEND_TRANSPORT_ERROR (payload elided)');
        throw safe;
      }
      // Successful path: ok=true, providerStatus=HTTP status, providerMessageId=id.
      if (outcome.kind === 'success') {
        emit(`send-adapter: providerStatus=${outcome.providerStatus} providerMessageId=${outcome.providerMessageId}`);
        return { ok: true, providerStatus: outcome.providerStatus, providerMessageId: outcome.providerMessageId, error: null };
      }
      // Refusal path: ok=false, error prefixed with the class code.
      // The recipient/subject/body are never placed on error or logs.
      const code = outcome.classCode || 'RESEND_TRANSPORT_ERROR';
      emit(`send-adapter: refusal code=${code} providerStatus=${outcome.providerStatus ?? 'null'} (payload elided)`);
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

// A provider seam that dials a caller-supplied SMTP catch-all
// endpoint (fixture) and returns a classified outcome for the
// adapter. Used by the offline round-trip probe and the offline
// unverified-sender-refusal probe. Classification maps 550 5.7.1
// to RESEND_SENDER_UNVERIFIED; any other 5xx to RESEND_TRANSPORT_ERROR.
export function createCatchAllSmtpProvider({ host, port, from }) {
  return {
    async dispatch({ to, subject, textBody, htmlBody }) {
      const { sendViaSmtp } = await import('./smtp-catch-all.mjs');
      const outcome = await sendViaSmtp({ host, port, from, to: Array.isArray(to) ? to[0] : to, subject, body: textBody ?? '' });
      const providerStatus = outcome.code ?? null;
      if (outcome.ok) {
        // synthetic id from the queued-as line, if present, else the
        // random hex the fixture emitted.
        const queued = outcome.transcript.find((l) => l.startsWith('250') && l.includes('queued as '));
        const id = queued ? queued.split('queued as ')[1].trim() : `smtp-${Date.now().toString(16)}`;
        return { kind: 'success', providerStatus: 250, providerMessageId: id, providerRequestId: null };
      }
      if (outcome.code === 550 && /5\.7\.1/.test(outcome.lastLine || '')) {
        return { kind: 'refusal', classCode: 'RESEND_SENDER_UNVERIFIED', providerStatus, providerRequestId: null };
      }
      return { kind: 'refusal', classCode: 'RESEND_TRANSPORT_ERROR', providerStatus, providerRequestId: null };
    },
  };
}
