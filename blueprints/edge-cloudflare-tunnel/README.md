# edge-cloudflare-tunnel

Round-7 T-3 core blueprint on the rcf-lite shelf. Bridges a service on a
`cloudHost` (bare, systemd shape) or a `containerHost` (compose-service
shape) to the Cloudflare edge through a Cloudflare Tunnel, with no
public origin ports. When applied alongside `edge-cloudflare-access`
(via the `zeroTrustGate` capability) the tunnel binds an Access AUD;
when applied without it the tunnel serves in public-hostname mode.

- Slug: `edge-cloudflare-tunnel`
- Version: `1.0.0`
- Category: `edge`
- Capabilities: `["tunnelBridge"]`
- Mints global topic: `edgeIngressBridge`
- Contribution count: 5 REQs, 8 USs, 3 TACs, 3 ADRs, 5 probes

## Five REQs

| Id | Contract |
|---|---|
| edge-cloudflare-tunnel-REQ-001 | Connector install shape switches on applied `containerHost` (compose-service default; systemd-unit for bare `cloudHost`); `cloudflaredReady` fires on boot with connector id, region and version metadata. |
| edge-cloudflare-tunnel-REQ-002 | Tunnel manifest schema at `cloudflare/tunnels/<name>.yaml` (uuid tunnel id, `credentialsFile.secretRef` reference, ingress rules with catch-all `http_status:404`). |
| edge-cloudflare-tunnel-REQ-003 | No public origin ports on the host; T-1 firewall stays closed on 80/443 unless a reverse proxy is applied; manifest refuses ingress rules whose service URL binds to a host public interface. |
| edge-cloudflare-tunnel-REQ-004 | Access-gated composition: `zeroTrustGate` applied attaches `originRequest.access.aud`; absent omits the block and serves in public-hostname mode. |
| edge-cloudflare-tunnel-REQ-005 | Credentials-file discipline (host mode 0o400, referenced via `secretRef`, not committed, grep-refuse, no leak in event bodies). |

## Connector runtime shapes

The connector runtime is elicited via `connector-runtime` (ADR-4002) with
`recommendedDefault: compose-service`.

- **compose-service** (default when `containerHost` is applied). The
  cloudflared container ships alongside the applying project services on
  the same web-net network. No host ports; restart `unless-stopped`;
  logging driver aligned with the T-2 compose-host log-driver elicit.
  Fixture: `packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/compose-service/`.
- **systemd-unit** (alternative for a bare `cloudHost`). The cloudflared
  binary is installed via the vendor package per the cloudflared
  as-a-service documented systemd unit and runs as a systemd service
  reading the local configuration file. Fixture:
  `packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/systemd-unit/`.

When to reach for which: pick compose-service when the project already
runs docker compose on the host (natural home, same log driver, same
restart discipline); pick systemd-unit when the host runs bare and there
is no compose stack to add a service to (or when the project deliberately
keeps cloudflared outside the compose lifecycle for boot ordering).

## Tunnel manifest shape

The manifest lives at `cloudflare/tunnels/<name>.yaml` under the
applying project. The shipped JSON schema
(`contributions/probes/tunnel-manifest.schema.json`) requires:

- `tunnel`: uuid-shaped Cloudflare Tunnel id.
- `credentialsFile.secretRef`: reference into `security-secrets-management`
  (never a literal path or JSON body inline).
- `ingress`: array of `{ hostname?, service, originRequest? }`. The last
  entry MUST be a catch-all `service: http_status:404`. When the
  Access-gated shape is applied every non-catch-all rule attaches
  `originRequest.access.aud` with the AUD from the sidecar.

Example (compose-service, public-hostname mode):

```yaml
tunnel: 00000000-0000-4000-8000-0000000012ab
credentialsFile:
  secretRef: vault/CLOUDFLARE_TUNNEL_CREDENTIALS_MY_PROJECT
ingress:
  - hostname: my-app.example.com
    service: http://web:8080
  - service: http_status:404
```

Example (Access-gated shape adds one block per non-catch-all rule):

```yaml
ingress:
  - hostname: my-app.example.com
    service: http://web:8080
    originRequest:
      access:
        aud: AUD-example-cloudflare-team
        teamName: my-team
        required: true
  - service: http_status:404
```

## Credentials-file discipline

The tunnel credentials JSON file lands on the host at mode 0o400 (owner
read only). The manifest references it as a `credentialsFile.secretRef`;
the fixture placeholder at
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/*/credentials/probe.json.example`
documents the pattern. The credentials file MUST NOT be committed to
the applying project tree; a grep across the working tree for the
tunnel id and account tag literals refuses on any tracked file. Every
`cloudflaredReady`, `tunnelConnectorUp` and `ingressRuleReloaded` event
body carries metadata only; the event-secrecy scan refuses on a body
that mentions the credentials literal.

Rotate credentials by rewriting the secret pointed to by `secretRef`
and re-applying; the connector reloads on the next boot cycle.

## Composition point (Access-gated vs public-hostname)

The hostname mode is discovered from the applied capability set (not
elicited; see ADR-4003). The blueprint reads the sidecar at
`rcf/blueprints/edge-cloudflare-tunnel.applied.json` and inspects
`appliedCapabilities`.

- When `zeroTrustGate` is present (i.e. `edge-cloudflare-access` v1.0.0
  is applied on the same project), every ingress rule attaches
  `originRequest.access.aud` and cloudflared refuses at the edge any
  request without a valid Access JWT for that AUD.
- When `zeroTrustGate` is absent, the block is omitted and the tunnel
  serves in public-hostname mode (open ingress on the public hostname;
  authorization is whatever the origin service itself carries).

The `aud-presence-check` probe refuses when the gated variant drifts to
omit the AUD block (defensive against silent degradation).

Graceful degrade: when Access is not applied (T-4 absent from
`origin/main` or the applying project simply does not want the gate),
the blueprint still ships in public-hostname mode. The probe assertion
runs on both fixture variants so the shape flip is proven on every
reviewer boot.

## No-public-ports rule

The T-1 firewall on a `cloudHost` allows 22 unconditionally and 80/443
only when a reverse proxy is applied. A project applying only T-1 plus
T-3 (no reverse proxy) declares zero 80/443 rules; the tunnel is the
sole path from the edge to the origin. The manifest schema refuses
ingress rules whose service URL binds to `0.0.0.0`, a non-loopback
numeric IP, or an unresolvable shape.

## Elicited parameters

- `tunnel-name` (string; default `probe`): the Cloudflare Tunnel name
  and the manifest filename under `cloudflare/tunnels/<name>.yaml`.
- `cloudflare-zone-secret` (string; default `vault/CLOUDFLARE_ZONE_ID`):
  `security-secrets-management` reference to the Cloudflare zone the
  tunnel serves under.
- `public-hostname-template` (string; default `<service>.<zone>`):
  template for the public hostname, expanded per ingress rule.
- `ingress-rules` (string; default `[]`): ingress rules array (hostname
  + service URL pairs).
- `access-aud` (string; default empty): Access AUD tag for the gated
  shape. Presence toggles the gated shape when `zeroTrustGate` is
  applied.
- `connector-runtime` (enum: `compose-service`, `systemd-unit`; default
  `compose-service`): the connector runtime per ADR-4002.

## Companions

- `suggestedCompanions[logging]`: every `cloudflaredReady`,
  `tunnelConnectorUp`, `tunnelConnectorDown`, `ingressRuleReloaded` and
  `accessGateRefused` event writes through the applied logger.
- `suggestedCompanions[errorHandling]`: a cloudflared exit, a JWT-check
  failure, an ingress-rule schema violation, a hostname-DNS-route API
  refusal constructs an internal error record.

`providesRoles: []`.

## Five probes

Every probe writes its report envelope to
`.rcf/reports/blueprints/edge-cloudflare-tunnel/<probe-name>.json`
under the repo root.

- **manifest-schema-validate** (local). Anchors AC-tunnel-manifestSchema,
  AC-tunnel-noPublicOrigin, AC-tunnel-credentialsDiscipline. `accountBound: false`.
  Ajv-free walker over the shipped JSON schema; runs on all four
  variants; refuses on `SIMULATE_MANIFEST_INVALID_TUNNEL_ID`,
  `SIMULATE_MANIFEST_CREDENTIALS_INLINE`, `SIMULATE_MANIFEST_MISSING_CATCHALL`,
  `SIMULATE_ORIGIN_PORT_OPEN`, `SIMULATE_EVENT_SECRECY_LEAK`.
- **cloudflared-config-lint** (local). Anchors AC-tunnel-hostnameRoutes.
  `accountBound: false`. Runs `cloudflared tunnel --config <path> ingress validate`
  via a local binary or the vendor container image
  `cloudflare/cloudflared:2026.8.3`; refuses on `SIMULATE_INGRESS_INVALID`.
- **aud-presence-check** (local). Anchors AC-tunnel-accessGated,
  AC-tunnel-accessGatedRefuse. `accountBound: false`. Reads the sidecar
  and the paired manifests; asserts the shape flips correctly; refuses
  on `SIMULATE_AUD_DROP` when the gated fixture drifts to open ingress.
- **real-account-connector-healthy** (account-bound). Anchors
  AC-tunnel-connectorHealthy. `accountBound: true` on
  `CI_HAS_CLOUDFLARE_ACCOUNT` AND `CI_HAS_HETZNER_ACCOUNT`. Without
  both, records `accountBoundSkipped: true` and the aggregate flips to
  `pass`.
- **real-account-tunnel-hostname-routes** (account-bound). Anchors
  AC-tunnel-hostnameRoutes (public sub-case) and AC-tunnel-accessGated
  (gated sub-case). `accountBound: true`. The public-hostname sub-case
  runs on `CI_HAS_CLOUDFLARE_ACCOUNT` + `CI_HAS_HETZNER_ACCOUNT`; the
  access-gated sub-case adds `CI_HAS_CLOUDFLARE_ACCESS` per the round-7
  Q4 ratification. Sub-cases skip independently.

The delegate shims at
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/run-<probe>.mjs`
read the `SIMULATE_*` env vars and prepare mutated inputs in a scratch
dir; the probe modules never read a `SIMULATE_` env var and never
branch on being under mutation.

## Two fixture variants times two hostname modes

The fixture lives under
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/`:

- `compose-service/compose-fragment.yaml`: the cloudflared compose
  service alongside the T-2 web and caddy services.
- `systemd-unit/cloudflared.service`: the systemd unit per the vendor
  as-a-service docs.
- `<runtime>/cloudflare/tunnels/public-hostname.yaml`: manifest without
  the AUD block.
- `<runtime>/cloudflare/tunnels/access-gated.yaml`: manifest with the
  AUD block on every non-catch-all rule.
- `<runtime>/credentials/probe.json.example`: placeholder credentials
  documenting the 0o400 mode discipline.
- `sidecars/access-gated.applied.json`: `appliedCapabilities` includes
  `zeroTrustGate`.
- `sidecars/public-hostname.applied.json`: `appliedCapabilities`
  excludes `zeroTrustGate`.

Reviewer boot (mocked, no account) from the fixture directory:

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-tunnel-manifest-schema-validate.mjs && node ./run-cloudflared-config-lint.mjs && node ./run-aud-presence-check.mjs
```

Reviewer boot (real account, throwaway server): set
`CI_HAS_CLOUDFLARE_ACCOUNT=true` and `CI_HAS_HETZNER_ACCOUNT=true`
(and `CI_HAS_CLOUDFLARE_ACCESS=true` for the gated sub-case) with the
account tokens loaded via `security-secrets-management`, then invoke the
two `run-real-account-*.mjs` scripts.

## Composition on the shelf

Consumes:
- `platform-docker-compose-host` v1.0.0 (`containerHost` capability) for
  the compose-service runtime path.
- `deploy-hetzner-server` v1.0.0 (`cloudHost` capability) for the bare
  systemd-unit runtime path.
- `security-secrets-management` v1.0.1 (`secretsProvider` capability) for
  the tunnel credentials `secretRef`.
- Optionally `edge-cloudflare-access` v1.0.0 (`zeroTrustGate` capability)
  for the Access-gated shape.

Provides:
- `tunnelBridge` (declared under `capabilities` on `blueprint.json`).
- New global topic `edgeIngressBridge` on ADR-4001 (scope global).

Conflict-by-design with future non-Cloudflare siblings on the
`edgeIngressBridge` topic: Tailscale Funnel, Fly.io proxy, etc.
would contribute the same topic string with a different mechanism.
Round 7 ships only the Cloudflare Tunnel provider.
