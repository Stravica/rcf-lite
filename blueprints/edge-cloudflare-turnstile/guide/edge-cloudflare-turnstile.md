# edge-cloudflare-turnstile guide

This guide walks the operator through applying the `edge-cloudflare-turnstile` v1.0.0 blueprint to a Workers project, wiring the client widget mount, calling the server-side siteverify, refusing missing-token submits, and composing the guard with `security-auth-magic-link` on the mint surface.

## 1. Prerequisites

- A Cloudflare Turnstile widget (sitekey and paired secret). Cloudflare documents issuing at `https://developers.cloudflare.com/turnstile/`. For CI and development, the fixture pins the always-pass and always-fail public test keys documented at `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`.
- A Cloudflare Workers project (`deploy-cloudflare-workers` applied) or the shipped pack fixture at `packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile/`.

## 2. Apply the blueprint

At apply time the blueprint elicits four values:

| Elicit | Answer |
|---|---|
| `turnstile-sitekey` | The Cloudflare Turnstile sitekey the widget renders with. |
| `turnstile-secret` | The paired secret. Store through the applied `security-secrets-management` companion. |
| `turnstile-widget-mode` | One of `managed` (default), `non-interactive`, `invisible`. |
| `turnstile-guarded-surfaces` | Comma-separated list of applied route ids the guard registers on. |

## 3. Client widget mount snippet

Paste the following into the public form surface. The mount injects Cloudflare Turnstile JS from `https://challenges.cloudflare.com` and populates the `Cf-Turnstile-Response` hidden input on submit.

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<form method="post" action="/api/submit">
  <label>Email <input type="email" name="email" required></label>
  <div class="cf-turnstile"
       data-sitekey="YOUR_TURNSTILE_SITEKEY"
       data-callback="onTurnstileToken"></div>
  <button type="submit">Submit</button>
</form>
<script>
window.onTurnstileToken = function (token) {
  var f = document.querySelector('form');
  var i = f.querySelector('input[name="Cf-Turnstile-Response"]');
  if (!i) {
    i = document.createElement('input');
    i.type = 'hidden';
    i.name = 'Cf-Turnstile-Response';
    f.appendChild(i);
  }
  i.value = token;
};
</script>
```

## 4. Server-side siteverify

Every submit is verified server-side by POSTing to Cloudflare's siteverify endpoint per `https://developers.cloudflare.com/turnstile/`. On `success:true` the handler proceeds; on `success:false` the handler rejects with 400 and the refusal body carries the documented `error-codes` value.

`curl` example:

```
curl -sS -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -d "secret=$TURNSTILE_SECRET" \
  -d "response=$CLIENT_TOKEN"
```

Response on pass:

```
{"success":true,"challenge_ts":"...","hostname":"..."}
```

Response on fail:

```
{"success":false,"error-codes":["invalid-input-response"]}
```

## 5. Refuse-if-token-missing guard

Every elicited surface is registered under the token-required guard. A submit whose payload has no `Cf-Turnstile-Response` field is refused with `400 {"errorCode":"turnstile.token-missing"}` before any downstream handler runs. The pack fixture (`packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile/server.js`) is the reference wiring; the applied Worker mirrors the shape.

## 6. Composition with security-auth-magic-link

When `security-auth-magic-link` is also applied, the composition hook (`TAC-3603`) registers the magic-link mint route under the Turnstile guard. The mint reads the Turnstile token check before invoking the mint. Example:

```
POST /api/magic-link
Content-Type: application/x-www-form-urlencoded

email=alice@example.com&Cf-Turnstile-Response=<TOKEN>
```

- Missing token: `400 {"errorCode":"turnstile.token-missing"}` with no mint side-effect.
- Failed siteverify: `400 {"errorCode":"turnstile.siteverify-failed","errorCodes":[...]}` with no mint side-effect.
- Pass: `200 {"mint":"ok"}` and the magic-link mint fires.

## 7. Widget mode

Cloudflare Turnstile documents three widget modes per `https://developers.cloudflare.com/turnstile/`: `managed` (Cloudflare decides when to render a challenge), `non-interactive` (always shows a non-interactive challenge) and `invisible` (invisible widget). The blueprint elicits the mode; the shipped default is `managed`.

The pack fixture accepts `?mode=<managed|non-interactive|invisible>` for a per-page-load override.

## 8. Test keys and CI

For CI or development the fixture pins Cloudflare's public test keys per `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`. The always-pass sitekey `1x00000000000000000000AA` and always-fail sitekey `2x00000000000000000000AB` drive the deterministic branches of the shipped probes. No real Turnstile credentials are required for the pack to run.

## 9. Observability

Every event record carries `sitekeyHash`, `outcome` and `timestamp` keys only. The token and the secret are never in the record. The `event-secrecy` probe asserts this shape on every apply.
