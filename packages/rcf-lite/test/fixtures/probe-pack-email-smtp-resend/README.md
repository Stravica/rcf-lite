# probe-pack-email-smtp-resend fixture

Self-contained fixture used by the `email-smtp-resend` blueprint's
contribution probes. Provides an in-process SMTP catch-all server
(`src/smtp-catch-all.mjs`) that accepts EHLO/MAIL/RCPT/DATA/QUIT and
records every envelope with a real per-connection message id
(returned in the initial 220 line for round-trip evidence).

## Declared env vars

Local branch:

- `RCF_FIXTURE_SMTP_PORT` (optional): overrides the port the fixture
  SMTP server binds; default 0 (kernel-assigned). Range 47550 for
  the port range used by this probe pack.

Live branch (Resend):

- `CI_HAS_RESEND_ACCOUNT` (first-tier gate): when unset the real-
  account probe records `accountBoundSkipped: true` and the aggregate
  flips to pass per spec section 3.5.
- `RESEND_API_KEY` (second-tier): Resend API key with send scope.

The live probe sends a real message to `delivered@resend.dev` from
`onboarding@resend.dev` (Resend sandbox), records the response's
email id and asserts the send returned 200. The Resend sandbox
domain is documented here:
https://resend.com/docs/dashboard/emails/send-test-emails
(verified 2026-09-11 for criterion e).

## Local run

```
# ensure Node 24 is first on PATH (project-specific incantation; see the repo docs)
node ./blueprints/email-smtp-resend/contributions/probes/run-smtp-round-trip.mjs
node ./blueprints/email-smtp-resend/contributions/probes/run-unverified-sender-refusal.mjs
node ./blueprints/email-smtp-resend/contributions/probes/run-real-account-resend-send.mjs
```
