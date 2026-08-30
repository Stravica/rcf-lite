# Stub Resend send adapter (record-only test double)

TAC-401 names a stub-adapter implementation the project wires into its test harness in place of the real Resend transport. The stub records every outgoing call in memory, resolves a fixed successful outcome by default, and lets a test override the outcome on a per-call basis. The stub satisfies exactly the same `send({ to, subject, textBody, htmlBody })` interface the real adapter does, so a project can swap it in without touching the auth wiring.

## Interface satisfied

```
send({ to, subject, textBody, htmlBody })
  -> Promise<{ ok, providerStatus, providerMessageId, error }>
```

The stub is shape-compatible with the magic-link blueprint's `TAC-504-security-auth-magic-link-email-delivery-adapter` and with the real Resend send adapter (`TAC-401-email-smtp-resend-send-adapter`); either can be swapped for the other at composition time.

## Fixed outcome (default successful case)

```json
{
  "ok": true,
  "providerStatus": 202,
  "providerMessageId": "stub-<n>",
  "error": null
}
```

`<n>` is the 1-based ordinal of the call in the recording session, so a test asserting on `providerMessageId` has a stable value to bind to.

## Fixed outcome (constructed failure case)

Constructed by the test with an override on the stub:

```json
{
  "ok": false,
  "providerStatus": 429,
  "providerMessageId": null,
  "error": "RESEND_RATE_LIMITED: stub configured to fail on attempt 1"
}
```

Every failure the stub returns starts with one of the four class codes named by REQ-003 (`RESEND_RATE_LIMITED`, `RESEND_SENDER_UNVERIFIED`, `RESEND_RECIPIENT_REJECTED`, `RESEND_TRANSPORT_ERROR`); tests binding to the class code are portable between the stub and the real adapter.

## In-memory call log shape

The stub exposes `sends`, an array of every call in the order received:

```json
[
  {
    "to": "operator@example.test",
    "subject": "Sign in",
    "textBody": "Someone asked to sign in ...",
    "htmlBody": "<!doctype html>..."
  }
]
```

Tests assert on `sends[0].to`, `sends[0].textBody.includes(signInUrl)`, and `sends.length === 1` per AC-4101-3.

## Retry harness

For AC-4103-1 and AC-4103-2, the stub exposes a `program` on which the test scripts a sequence of return values consumed one per attempt: `[{ ok: false, error: 'RESEND_RATE_LIMITED: ...' }, { ok: true, providerStatus: 202, ... }]` returns rate-limited on the first attempt and accepts on the second. The stub increments a `submissionCounter` on every call the retry loop makes, which is the counter AC-4103-1 through AC-4103-3 bind to.

## Do not use in production

The stub is a test surface. Loading the stub in a production build silently defeats the send flow: mint succeeds, no message ever leaves the process, and only the presence of the stub in the deployment's dependency graph would tell an operator what happened. A project's deployment configuration refuses the stub adapter's module name in production; the mechanism for that refusal is a project-side configuration decision, not shipped in this blueprint.
