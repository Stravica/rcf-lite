# Guide: edge-cloudflare-tunnel

The edge-cloudflare-tunnel blueprint bridges a service on a `cloudHost`
or a `containerHost` to the Cloudflare edge through a Cloudflare Tunnel,
with no public origin ports. This guide walks the shape end to end:
what the connector looks like, what the manifest looks like, how the
Access-gated shape composes on top of the public-hostname shape, and
how the credentials-file discipline stays honest on every reapply.

## When to reach for this blueprint

Reach when the applying project needs to expose a service on the public
internet without opening origin ports on the host and without standing
up a bespoke reverse proxy in front of the CDN. The tunnel connector
dials out to the Cloudflare edge and terminates ingress there; the host
firewall (from deploy-hetzner-server) can stay closed on 80/443 unless a
reverse proxy is also applied.

Do not reach for this blueprint when the applying project runs on
Cloudflare Workers (`deploy-cloudflare-workers` handles ingress
directly), when the applying project runs behind a corporate VPN
(private connectivity has different tools), or when the ingress path
needs a non-Cloudflare bridge shape (Tailscale Funnel, Fly.io proxy;
those will mint on operator demand into their own reserved slots).

## Connector runtime: when to reach for compose-service vs systemd-unit

The connector runtime is elicited via `connector-runtime` per ADR-4002
with `recommendedDefault: compose-service`.

Reach for **compose-service** (the shipped default when `containerHost`
is applied) when the applying project already runs docker compose on
the host. The connector ships as another service in the same stack,
sharing the compose network, the log driver and the restart discipline.
The platform-docker-compose-host contract makes this the natural
home; the connector composes on `containerHost` from platform-docker-compose-host.

Reach for **systemd-unit** when the host runs bare (only deploy-hetzner-server applied)
and there is no compose stack to add a service to. The connector runs
as a systemd unit per the vendor cloudflared as-a-service documented
systemd unit; the unit file lives at `/etc/systemd/system/cloudflared.service`
on the host and reads the local configuration file at
`/etc/cloudflared/<name>.yaml`. Boot ordering plays nicely with journald.

The fixture ships both variants under
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/{compose-service,systemd-unit}/`
and both pass `manifest-schema-validate`, `cloudflared-config-lint` and
`aud-presence-check` on every reviewer boot.

## Hostname mode: when to reach for Access-gated vs public-hostname

The hostname mode is not elicited. It is DISCOVERED from the applied
capability set (ADR-4003). When `zeroTrustGate` is applied (i.e.
edge-cloudflare-access v1.0.0 is applied on the same project), every
ingress rule attaches `originRequest.access.aud` with the AUD from the
sidecar. When `zeroTrustGate` is not applied, the block is omitted and
the tunnel serves in public-hostname mode.

Reach for **access-gated** when the service behind the tunnel needs an
authentication gate at the edge (any request without a valid Access
JWT is refused before it hits the origin). The Access side of the
composition is owned by edge-cloudflare-access; edge-cloudflare-tunnel
only reads the sidecar and attaches the AUD block. See the vendor
self-hosted-public-app documentation for the full AUD binding shape.

Reach for **public-hostname** when the service is deliberately public
(a marketing page, a documentation site, or a public API where
authorisation lives at the origin). The tunnel still terminates
ingress at the CF edge; no origin port is opened; the difference is
that cloudflared does not check for a JWT before forwarding.

Mode selection is a pure function of the applied capability set. When
`zeroTrustGate` is present on the applied capabilities, the elicited
`access-aud` value is **mandatory**: apply refuses with code
`apply.tunnel-aud-missing` if the value is blank, and every ingress
rule attaches an `originRequest.access` block. There is no silent
degrade to public-hostname mode under an applied gate. When
`zeroTrustGate` is absent, the tunnel serves in the deliberate
public-hostname mode per ADR-4003; the `aud-presence-check` probe
runs on both fixture variants and asserts the shape flips correctly.

## Tunnel manifest walkthrough

The applying project ships one tunnel manifest per named tunnel at
`cloudflare/tunnels/<name>.yaml`. A minimal public-hostname manifest:

```yaml
tunnel: 12345678-90ab-4cde-8f12-3456789abcde
credentialsFile:
  secretRef: vault/CLOUDFLARE_TUNNEL_CREDENTIALS_MY_PROJECT
ingress:
  - hostname: my-app.example.com
    service: http://web:8080
  - service: http_status:404
```

An access-gated manifest adds one `originRequest.access` block per
non-catch-all rule:

```yaml
tunnel: 12345678-90ab-4cde-8f12-3456789abcde
credentialsFile:
  secretRef: vault/CLOUDFLARE_TUNNEL_CREDENTIALS_MY_PROJECT
ingress:
  - hostname: my-app.example.com
    service: http://web:8080
    originRequest:
      access:
        aud: AUD-example-team
        teamName: my-team
        required: true
  - service: http_status:404
```

The shipped JSON schema at
`blueprints/edge-cloudflare-tunnel/contributions/probes/tunnel-manifest.schema.json`
requires: a uuid-shaped `tunnel` id, a `credentialsFile.secretRef`
reference (never a literal path or inline JSON body), and an ingress
rules array whose last entry is a catch-all `service: http_status:404`.
Every ingress service URL must bind to an internal address (a compose
service name or a loopback interface); binding to `0.0.0.0` or a
non-loopback numeric IP refuses at apply time.

## Zone resolution

The applying project stores the target Cloudflare zone id as a secret
reference rather than as a plaintext value in the tracked tree. TAC-4004
owns the zone-resolution seam: at apply the resolver reads the elicited
`cloudflare-zone-secret` through the `security-secrets-management`
companion, and the resulting applied sidecar records only the
`secretRef`. A grep across the applying tree for the resolved zone id
must find zero matches on the tracked file set. Failure paths, per
REQ-006:

- If the elicited `cloudflare-zone-secret` does not resolve via the
  vault seam (the reference is missing, or the seam returns an error),
  apply refuses with `apply.zone-unresolved` naming the elicit id and
  writes no sidecar (US-39109 AC-tunnel-zoneUnresolved).
- If the Cloudflare API returns 401 or 403 on the tunnel-route call for
  the resolved zone id, apply refuses with `apply.zone-unauthorised`
  naming the resolved zone id metadata (never the token) and writes no
  sidecar (US-39109 AC-tunnel-zoneUnauthorised).

## Public-hostname template expansion

TAC-4004 owns the public-hostname template. The default template is
`<service>.<zone>` and each ingress rule's public hostname is rendered
by substituting the `service` placeholder with the ingress rule's
service name and the `zone` placeholder with the resolved zone. Every
rendered hostname must match the DNS-label regex
`^[a-z0-9-]+(\.[a-z0-9-]+)+$`. Failure paths, per REQ-007:

- If the template names an undefined placeholder (for example
  `<unknown>`), carries an unclosed brace (for example
  `<service.<zone>`), or renders a value that violates DNS-label rules
  (labels longer than 63 characters, or characters outside `[a-z0-9-]`),
  apply refuses with `apply.hostname-template-malformed` naming the
  offending template and writes no sidecar (US-39110
  AC-tunnel-hostnameTemplateMalformed).
- If two distinct service names expand under the elicited template to
  the same concrete hostname (for example a template with the
  `<service>` placeholder omitted or replaced by a constant), apply
  refuses with `apply.hostname-template-duplicate` naming the collided
  hostname and both offending rule indices; no sidecar is written
  (US-39110 AC-tunnel-hostnameTemplateDuplicate).

## Credentials rotation pattern

The tunnel credentials JSON file lands on the host at mode 0o400 (owner
read only) and is referenced from the manifest as a
`credentialsFile.secretRef`. To rotate:

1. Regenerate the credentials via `cloudflared tunnel token <name>` or
   the Cloudflare API against the tunnel id.
2. Update the secret named by the manifest's `secretRef` via
   `security-secrets-management`.
3. Trigger a reapply on the applying project; the connector picks up
   the new credentials on its next boot cycle.

The credentials file MUST NOT be committed to the applying tree; a
grep across the working tree for the tunnel id and account tag
literals refuses on any tracked file. Every `cloudflaredReady`,
`tunnelConnectorUp` and `ingressRuleReloaded` event body carries
metadata only; the event-secrecy scan refuses on a body that mentions
the credentials literal.

## Composition on the shelf

Consumes: `platform-docker-compose-host` (compose-service runtime),
`deploy-hetzner-server` (bare cloudHost systemd runtime),
`security-secrets-management` (credentials secretRef). Optionally
consumes `edge-cloudflare-access` (the Access-gated shape).

Provides: `tunnelBridge` capability; new global topic
`edgeIngressBridge` (ADR-4001 scope global).

The `deliver-ci-workflows` shelf blueprint invokes the two account-bound
probes on a scratch subdomain when the account tokens are present;
without them the probes record `accountBoundSkipped: true` and the
aggregate flips to pass when both env vars are absent.

## Running the probes

Every reviewer boot exercises the three local probes on the fixture:

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-tunnel-manifest-schema-validate.mjs
node ./run-cloudflared-config-lint.mjs
node ./run-aud-presence-check.mjs
```

Every probe writes its report envelope to
`.rcf/reports/blueprints/edge-cloudflare-tunnel/<probe-name>.json`
under the repo root.

Mutations (fixture-side, one per switch; the probe modules never read
`SIMULATE_` env vars):

- `SIMULATE_MANIFEST_INVALID_TUNNEL_ID=true` on `run-tunnel-manifest-schema-validate.mjs`
- `SIMULATE_MANIFEST_CREDENTIALS_INLINE=true` on `run-tunnel-manifest-schema-validate.mjs`
- `SIMULATE_MANIFEST_MISSING_CATCHALL=true` on `run-tunnel-manifest-schema-validate.mjs`
- `SIMULATE_ORIGIN_PORT_OPEN=true` on `run-tunnel-manifest-schema-validate.mjs`
- `SIMULATE_EVENT_SECRECY_LEAK=true` on `run-tunnel-manifest-schema-validate.mjs`
- `SIMULATE_INGRESS_INVALID=true` on `run-cloudflared-config-lint.mjs`
- `SIMULATE_AUD_DROP=true` on `run-aud-presence-check.mjs`

Real-account probes need `CI_HAS_CLOUDFLARE_ACCOUNT=true` and
`CI_HAS_HETZNER_ACCOUNT=true` (plus `CI_HAS_CLOUDFLARE_ACCESS=true` for
the gated sub-case):

```
CI_HAS_CLOUDFLARE_ACCOUNT=true CI_HAS_HETZNER_ACCOUNT=true \
  node ./run-real-account-connector-healthy.mjs
CI_HAS_CLOUDFLARE_ACCOUNT=true CI_HAS_HETZNER_ACCOUNT=true CI_HAS_CLOUDFLARE_ACCESS=true \
  node ./run-real-account-tunnel-hostname-routes.mjs
```

Without the env vars the probes record `accountBoundSkipped: true` and
the aggregate flips to pass.

## Standards trace

- Cloudflare Tunnel overview: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Get-started with Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
- cloudflared downloads: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- Routing to a tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/
- Local configuration file: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/local-management/configuration-file/
- cloudflared as-a-service: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/tunnel-guide/local/as-a-service/
- Self-hosted app in front of a tunnel (Access): https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/
- Cloudflare Access policies: https://developers.cloudflare.com/cloudflare-one/policies/access/
