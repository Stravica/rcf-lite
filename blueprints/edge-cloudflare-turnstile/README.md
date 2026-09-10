# edge-cloudflare-turnstile

Cloudflare Turnstile as a CAPTCHA-alternative on public-facing forms. Ships the client widget mount, the server-side siteverify verifier (POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the elicited secret), a refuse-if-token-missing guard on every elicited surface, and a composition hook into the `security-auth-magic-link` mint surface.

- Slug: `edge-cloudflare-turnstile`
- Category: `edge`
- Version: `1.0.0`
- Capabilities: `["humanCheck"]`
- Standards: Cloudflare Turnstile (`https://developers.cloudflare.com/turnstile/`), Cloudflare Turnstile testing (`https://developers.cloudflare.com/turnstile/troubleshooting/testing/`)

## What this blueprint commits

| REQ | Commits |
|---|---|
| `edge-cloudflare-turnstile-REQ-001` | Client widget mount: the elicited sitekey renders the Turnstile widget; the mount injects no third-party script beyond the Cloudflare Turnstile JS host. |
| `edge-cloudflare-turnstile-REQ-002` | Server-side siteverify: POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the elicited secret; on `success:true` the handler proceeds; on `success:false` the handler rejects with 400. |
| `edge-cloudflare-turnstile-REQ-003` | Refuse-if-token-missing guard on elicited surfaces: a submit without a token rejects with 400 before hitting downstream logic. |
| `edge-cloudflare-turnstile-REQ-004` | Composition with `security-auth-magic-link`: when both are applied, the magic-link mint surface refuses a submit without a valid Turnstile token. |
| `edge-cloudflare-turnstile-REQ-005` | Widget mode is an elicited enum: `managed`, `non-interactive`, `invisible` per Cloudflare's documented modes. `recommendedDefault: managed`. |

## Contract at a glance

- **Client widget mount** (TAC-3601) injects Cloudflare Turnstile JS from `https://challenges.cloudflare.com` and no other origin; renders the widget for the elicited sitekey; populates the hidden `cf-turnstile-response` token field on submit.
- **Server-side siteverify verifier** (TAC-3602) POSTs `{secret, response}` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. On `success:true` the handler proceeds. On `success:false` the handler rejects with 400 and the refusal body carries the documented `error-codes` value; the sitekey is never in the refusal body.
- **Refuse-if-token-missing guard** (TAC-3602) is the sole reader of the `cf-turnstile-response` payload field; a submit without a token rejects with `400 {"errorCode":"turnstile.token-missing"}` before any downstream handler runs.
- **Composition with security-auth-magic-link** (TAC-3603) registers the magic-link mint route under the Turnstile guard so a mint submit reads through the same token check.
- **Widget mode** (ADR-3602) is an elicited enum: `managed`, `non-interactive`, `invisible`. Default: `managed`.

## Elicited parameters

| Id | Purpose |
|---|---|
| `turnstile-sitekey` | Cloudflare Turnstile sitekey the widget renders with. Public per Cloudflare's testing docs when a test sitekey is applied. |
| `turnstile-secret` | Cloudflare Turnstile secret the server-side verifier POSTs with. Delegated to `security-secrets-management` when applied. |
| `turnstile-widget-mode` | Enum `managed` \| `non-interactive` \| `invisible`. `recommendedDefault: managed`. |
| `turnstile-guarded-surfaces` | List of applied route ids the token-required guard registers on. |

## Companions

- **`suggestedCompanions[logging]`**: every siteverify call and every refuse-if-token-missing rejection writes through the applied logger.
- **`suggestedCompanions[errorHandling]`**: siteverify network failure, malformed token, missing sitekey/secret build an internal error record.
- **`suggestedCompanions[secretsManagement]`**: the paired sitekey and secret are stored in the operator's applied `secretsManagement` companion.

## Composition

- Consumes `security-secrets-management` for the sitekey/secret pair when applied.
- Composes with `security-auth-magic-link` at the mint surface via `TAC-3603`.
- Provides capability `humanCheck` per section 6a of `blueprint-authoring.md`.
- One scope-global ADR (`ADR-3601`) on new topic `humanVerificationGate`. A future hCaptcha or reCAPTCHA sibling contributes the same topic string with a different answer and forces a deliberate operator-resolved conflict.

## Probes and pack

Four Node-only probes under `contributions/probes/`:

| Probe | Anchors | Engine |
|---|---|---|
| `secret-shape-scan` | `AC-35107-1` | Source-tree AST scan over the pack fixture. |
| `siteverify-fixture` | `AC-35102-1` | Live POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with pinned Cloudflare public test secrets. |
| `guard-shape-scan` | `AC-35104-1` | Source-tree scan plus a live missing-token POST against every guarded surface. |
| `event-secrecy` | `AC-35108-1` | Live pass + fail runs through the verifier; asserts every event carries `sitekeyHash`, `outcome`, `timestamp` and no token or secret substring. |

One Playwright pack at `probe-packs/edge-cloudflare-turnstile.pack.mjs` with four surface-observable checks: `AC-turnstile-widgetRendered`, `AC-turnstile-serverVerified-pass`, `AC-turnstile-serverVerified-fail`, `AC-turnstile-magicLinkGuard`. The pack ships no `appliesTo` gate; every fixture that applies the blueprint fires every check.

The dedicated pack fixture at `packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile/` pins the Cloudflare public test keys (documented at `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`) as environment defaults so the pack runs without real Turnstile credentials.

## Pinned Cloudflare public test keys

Per Cloudflare's testing page (`https://developers.cloudflare.com/turnstile/troubleshooting/testing/`):

| Sitekey | Behaviour |
|---|---|
| `1x00000000000000000000AA` | Always passes |
| `2x00000000000000000000AB` | Always blocks |
| `3x00000000000000000000FF` | Forces an interactive challenge |
| `1x00000000000000000000BB` | Invisible widget, always passes |
| `2x00000000000000000000BB` | Invisible widget, always blocks |

| Secret | Behaviour |
|---|---|
| `1x0000000000000000000000000000000AA` | Always passes on siteverify |
| `2x0000000000000000000000000000000AA` | Always fails on siteverify |
| `3x0000000000000000000000000000000AA` | Token already spent |

These keys are public per Cloudflare's documentation; they are safe to pin as fixture defaults and are not operational secrets.

## Risks

1. Client-side widget mounts a third-party script. The `AC-turnstile-widgetRendered` pack check pins the mount to `https://challenges.cloudflare.com` only and fails if any other origin is contacted (see the `?break=other-origin` negative proof in the fixture `proof/` directory).
2. Test sitekeys are the only always-green option for CI. The guide names the pass, block and forced-interactive modes per Cloudflare's testing page so an operator can pick a mode for staging.

## Standards trace

- Cloudflare Turnstile: `https://developers.cloudflare.com/turnstile/`
- Cloudflare Turnstile testing: `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`
- Cloudflare Turnstile siteverify endpoint: `https://challenges.cloudflare.com/turnstile/v0/siteverify`
