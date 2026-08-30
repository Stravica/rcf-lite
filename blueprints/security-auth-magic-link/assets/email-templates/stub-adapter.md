# Stub email adapter

The blueprint's TAC-504 names a stub-adapter implementation that projects wire into their test harness in place of the real transport. The stub records every outgoing call in memory and resolves the fixed outcome below; nothing leaves the process.

## Interface satisfied

```
send({ to, subject, textBody, htmlBody })
  -> Promise<{ ok, providerStatus, providerMessageId, error }>
```

## Fixed outcome (successful case)

```json
{
  "ok": true,
  "providerStatus": 200,
  "providerMessageId": "stub",
  "error": null
}
```

## Fixed outcome (failing case)

Constructed by the test with an override:

```json
{
  "ok": false,
  "providerStatus": 502,
  "providerMessageId": null,
  "error": "stub configured to fail: <reason>"
}
```

## In-memory call log shape

The stub exposes `sends`, an array of every call in the order received:

```json
[
  {
    "to": "operator@example.com",
    "subject": "Sign in to demo-app",
    "textBody": "Someone (hopefully you) asked ...",
    "htmlBody": "<!doctype html>..."
  }
]
```

Tests assert on `sends[0].to`, `sends[0].textBody.includes(signInUrl)`, and `sends.length === 1` per AC-3110-3 and AC-3101-3.

## Do not use in production

The stub is a test surface. Loading the stub in a production build defeats the sign-in flow silently: mint succeeds, the recipient never receives a link, the anti-enumeration budget hides the failure from the response, and only the `adapterSendFailed` event log entry names the problem (and even then, only if a real send would have failed; a stub records success). A project's deployment config forbids the stub adapter's module name in production; see the project's own configuration ADR for the mechanism.
