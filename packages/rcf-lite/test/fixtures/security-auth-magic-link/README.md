# security-auth-magic-link fixture

Shared fixture for the security-auth-magic-link blueprint's probe
pack (criterion e hardening, 2026-09-11). Ships a TAC-501 magic-
link manager fixture (single-use, TTL-bounded, email-bound token
with a constant-time email compare on verify) plus the live probe
that drives Resend's HTTP API against its documented sandbox
recipient for real evidence.

## Layout

- `src/magic-link-manager.mjs` - TAC-501 issue / verify manager
  with an injectable clock so token expiry can be exercised
  deterministically without SIMULATE_* switches. Uses
  `crypto.randomBytes(32).toString('base64url')` for the token and
  `crypto.timingSafeEqual` for the email compare on verify.

## Probes composed against this fixture

- `token-issue-verify` (local, capability `principalDirectory`;
  covers issue, wrong-email refusal, happy verify, replay refusal
  and expired-token refusal on a deterministic clock).
- `token-entropy-shape` (local, capability `principalDirectory`;
  200 tokens uniqueness + base64url shape check).
- `real-account-magic-link-send` (live against Resend HTTP API;
  issues a real token, sends to `delivered@resend.dev` from
  `onboarding@resend.dev`, records the Resend-assigned email id
  and the request-id header; verifies the token locally to prove
  end-to-end shape).

## Declared env vars

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `CI_HAS_RESEND_ACCOUNT` | first | Gate for the account-bound branch on the real-Resend probe. | `real-account-magic-link-send.mjs` |
| `RESEND_API_KEY` | second | Resend API key presented as `Authorization: Bearer <key>` to `POST /emails`. Never logged, never written to a file. | `real-account-magic-link-send.mjs` |
| `RESEND_API_BASE_URL` | optional | Test-only override for the Resend API base URL. Defaults to `https://api.resend.com`. Not a skip trigger. | `real-account-magic-link-send.mjs` |
| `RESEND_SANDBOX_FROM` | optional | Sender address. Defaults to `onboarding@resend.dev` (Resend's documented sandbox sender per https://resend.com/docs/dashboard/emails/send-test-emails verifiedOn 2026-09-11). | `real-account-magic-link-send.mjs` |
| `RESEND_SANDBOX_TO` | optional | Recipient address. Defaults to `delivered@resend.dev` (Resend's documented sandbox delivered recipient; routes to the accepted-and-simulated path without reaching a real mailbox). | `real-account-magic-link-send.mjs` |

## Vendor citations

- Resend send-email API reference:
  https://resend.com/docs/api-reference/emails/send-email, verifiedOn 2026-09-11.
- Resend sandbox test emails (delivered@ / bounced@ / complained@):
  https://resend.com/docs/dashboard/emails/send-test-emails, verifiedOn 2026-09-11.
