# probe-pack-edge-cloudflare-turnstile fixture

Dependency-free sample app the `edge-cloudflare-turnstile` probe pack drives on the shelf gate. One Node HTTP server, an inline client that mounts the Cloudflare Turnstile widget, a server-side POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the elicited secret, a token-required guard registered on every elicited surface, and a magic-link mint stub route composed with the same guard.

The fixture is the target for the T-5 track of the Cloudflare round 6 spec (2026-09-06 section 3.3): a dedicated pack fixture that pins Cloudflare public test keys as environment defaults so the pack does not need real Turnstile credentials to run.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile
node server.js
```

Prints `LISTENING <port>` once bound. `PORT=0` binds a free port.

## Pinned Cloudflare Turnstile test keys

Every default below is a Cloudflare public test key documented at `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`. The test keys are public: the fixture pins them as environment defaults so the pack runs without real Turnstile credentials.

| Key | Value | Behaviour |
|---|---|---|
| `TURNSTILE_SITEKEY` | `1x00000000000000000000AA` | Always passes |
| `TURNSTILE_BLOCK_SITEKEY` | `2x00000000000000000000AB` | Always blocks |
| `TURNSTILE_FORCED_SITEKEY` | `3x00000000000000000000FF` | Forces an interactive challenge |
| `TURNSTILE_INVISIBLE_SITEKEY` | `1x00000000000000000000BB` | Invisible widget, always passes |
| `TURNSTILE_INVISIBLE_BLOCK_SITEKEY` | `2x00000000000000000000BB` | Invisible widget, always blocks |
| `TURNSTILE_SECRET` | `1x0000000000000000000000000000000AA` | Always passes on siteverify |
| `TURNSTILE_FAIL_SECRET` | `2x0000000000000000000000000000000AA` | Always fails on siteverify |

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port. Never `4200` (workspace server owns that port; the fixture refuses on `4200`). | `3000` |
| `TURNSTILE_SITEKEY` | Client widget sitekey the mount renders with. | See table above |
| `TURNSTILE_SECRET` | Server-side secret the verifier POSTs with. | See table above |
| `TURNSTILE_FAIL_SECRET` | Secret used when `?fail-secret=1` is passed on the request. | See table above |
| `TURNSTILE_WIDGET_MODE` | Default widget mode: `managed`, `non-interactive`, `invisible`. | `managed` |
| `TURNSTILE_GUARDED_SURFACES` | Comma-separated list of route paths the token-required guard registers on. | `/api/submit,/api/magic-link` |
| `SITEVERIFY_URL` | Override the siteverify endpoint. | `https://challenges.cloudflare.com/turnstile/v0/siteverify` |

## Query switches

| Query | Purpose |
|---|---|
| `?sitekey=<pass\|block\|forced\|invisible-pass\|invisible-block>` | Select a pinned sitekey for a single page load. Default `pass`. |
| `?mode=<managed\|non-interactive\|invisible>` | Select the widget mode for a single page load. Default from `TURNSTILE_WIDGET_MODE`. |
| `?break=missing-token` | Do not populate the hidden token field (guard branch surfaces `400 turnstile.token-missing`). |
| `?break=other-origin` | Also mount an additional script from a non-Cloudflare origin (`https://example.com/not-cloudflare.js`); the pack `widgetRendered` check surfaces the third-party-script fail. |
| `?fail-secret=1` | Force the server to POST with `TURNSTILE_FAIL_SECRET` for the current request (drives `serverVerified-fail` without a re-boot). |

## Routes

- `GET /` public contact form (mounts the Turnstile widget).
- `GET /magic-link` magic-link mint form (composed with the Turnstile guard).
- `POST /api/submit` server-side siteverify + handler. `200` on pass, `400` on fail.
- `POST /api/magic-link` magic-link mint stub. Refused with `400` without a valid Turnstile response.
- `GET /api/events` event sink dump as JSON, for the `event-secrecy` probe.
- `POST /api/events/clear` clears the event sink.

## Manual boot for the gate reviewer

Two lines cover the sitekey and secret branches the T-5 gate rows walk:

```
PORT=4901 TURNSTILE_SITEKEY=1x00000000000000000000AA TURNSTILE_SECRET=1x0000000000000000000000000000000AA node server.js   # pass branch
PORT=4902 TURNSTILE_SITEKEY=2x00000000000000000000AB TURNSTILE_SECRET=2x0000000000000000000000000000000AA node server.js   # fail branch (or use ?fail-secret=1 per-request)
```

Then hit:

- `GET /?sitekey=pass` and confirm the Turnstile widget mounts (`[data-role="turnstile-widget"]`), Cloudflare Turnstile JS is loaded from `challenges.cloudflare.com`, no third-party script is loaded, and the hidden `cf-turnstile-response` input carries a token value.
- `POST /api/submit` with the pass token and confirm `200 {"received":"ok"}`.
- `POST /api/submit?fail-secret=1` with any token and confirm `400 {"errorCode":"turnstile.siteverify-failed","errorCodes":["invalid-input-response"]}`.
- `POST /api/submit` with no `cf-turnstile-response` and confirm `400 {"errorCode":"turnstile.token-missing"}`.
- `POST /api/magic-link` with no token and confirm `400 {"errorCode":"turnstile.token-missing"}`.
- `GET /api/events` and confirm every event carries `sitekeyHash`, `outcome` and `timestamp` only.

## Proofs

The `proof/` directory ships the MCP-route pack proofs the T-5 gate reviewer reads:

- `pack-mcp-route.<ts>.json` positive: all four pack checks green with a real Playwright chromium driver.
- `pack-mcp-route.negative-guard-removed.<ts>.json` negative: `magicLinkGuard` FAILS when the token guard is removed from the mint route.
- `pack-mcp-route.negative-third-party-script.<ts>.json` negative: `widgetRendered` FAILS when a non-Cloudflare script is injected.

Every check is proven surface-observable on a real browser; a stubbed pack browser is not sufficient (round-4 T-4 gate lesson, inherited).
