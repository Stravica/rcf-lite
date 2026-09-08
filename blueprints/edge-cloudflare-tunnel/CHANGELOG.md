# edge-cloudflare-tunnel CHANGELOG

## 1.0.0 - 2026-09-08

Initial release. Round-7 T-3 of the Hetzner spec at `projects/blueprint-library/specs/hetzner-round-7-spec-2026-09-07.md`.

- Mints capability `tunnelBridge` and global topic `edgeIngressBridge`.
- Five REQs, eight USs, three TACs, three ADRs; five Node-only probes.
- Extends the shared throwaway-Hetzner-server fixture with a cloudflared connector in both runtime shapes (compose-service alongside the T-2 web and caddy services when `containerHost` is applied; systemd-unit for a bare `cloudHost`) and both hostname modes (access-gated when `zeroTrustGate` is applied; public-hostname when absent) plus five `run-<probe>.mjs` delegate shims.
- manifest-schema-validate carries five fixture-side mutation switches (`SIMULATE_MANIFEST_INVALID_TUNNEL_ID`, `SIMULATE_MANIFEST_CREDENTIALS_INLINE`, `SIMULATE_MANIFEST_MISSING_CATCHALL`, `SIMULATE_ORIGIN_PORT_OPEN`, `SIMULATE_EVENT_SECRECY_LEAK`); cloudflared-config-lint carries `SIMULATE_INGRESS_INVALID` and runs `cloudflared tunnel ingress validate` via the `cloudflare/cloudflared:2026.8.3` container when a local binary is not on PATH; aud-presence-check carries `SIMULATE_AUD_DROP`.
- Mutation-discipline (T-2 gate ruling carried forward): every `SIMULATE_*` switch lives in the fixture-side delegate shim; the probe modules read only `RCF_LITE_T3_FIXTURE_ROOT` and never branch on being under mutation.
- Connector-runtime choice elicited via `connector-runtime` (compose-service default when `containerHost` applied; systemd-unit alternative for bare `cloudHost`, per the vendor cloudflared as-a-service local-configuration-file docs); hostname-mode discovered (not elicited) from `appliedCapabilities` via the sidecar per ADR-4003.
- Consumers: `w-2026-09-06-dave-010` follow-on (make the librarian API and workspace viewer reachable without Mullvad) is the estate consumer; blueprint acceptance never depends on that consumer, and the ops-01 migration mints as its own work item.
