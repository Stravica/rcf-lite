# observability-probe-endpoints CHANGELOG

## 1.2.3 - 2026-09-11

Adds a contributions/probes/ pack (profile-boot-materialisation, kubernetes-startup-enabled, partial-profile-refusal) with a fixture-side profile registry and HTTP materialiser under packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/. Probes run against the fixture on Node 24. No account gate.

Anchoring: kubernetes-startup-enabled anchors AC-14102-4 with BOTH the enabled clause (three-path resolution; pre-ready GET /startup answers HTTP 503 body.status='fail'; post-markStartupReady GET answers HTTP 200 body.status='pass') AND the disabled clause (no enable flag: resolver returns two paths, GET /startup returns 404 with no /startup handler registered). profile-boot-materialisation observes bound-path behaviour for /live and /ready under the shipped kubernetes profile; the row de-claims (conformanceOnly, anchorAcId=null) with the limitation naming AC-14101-1 (port topology and handler-absence not observed). partial-profile-refusal observes an in-process refuseIfPartial refusal (stripped transport; startupEnabled without paths.startup) with the row de-claiming AC-14103-2 (process-level non-zero exit not observed at shelf); the shape presence check for the six shipped profiles de-claims AC-14103-1 (enum-membership per field not observed); the loadBalancer profile shape row de-claims AC-14103-3 (profile is not materialised and probed for handler absence). probe-utils normalisation and thrown-error rows carry an evidence object; the fallback anchorAcId is null.

## 1.2.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.2.0 (hardening pass, 2026-09-09)

- Adds `elicits[]` with four apply-time answers: `probe-interface-profile` (enum kubernetes/loadBalancer/uptimeMonitor/systemd/dockerHealthcheck/reverseProxy/custom, default kubernetes; REQ-001), `probe-paths-override` (string JSON; REQ-002/003), `probe-listener-separate-port` (string; REQ-004), `kubernetes-startup-enabled` (enum off/on, default off; ADR-1503). Every option value is backed by a must-priority REQ description.
- Adds `deliveredBy` to every REQ (REQ-001-008 -> TAC-1501/1502/1503/1504 interface names; REQ-006 -> ADR-1505). Closes 7 pass-2 lint findings.
- Closes F-1 chain-contradiction specimen: settles missing-profile semantics as fallback-to-Kubernetes-default (per ADR-1503), not refuse. REQ-001 rewritten to name precedence (explicit declaration wins, absent falls back, unknown/malformed refused with stable codes PROBE_PROFILE_UNKNOWN / PROBE_PROFILE_MALFORMED). AC-14101-2 rebased to the fallback path; AC-14101-4 added for malformed.
- Closes F-3 (liveness failure without AC coverage): adds AC-14102-5 asserting a response-capable in-process liveness self-check predicate answers HTTP 503 with content-length 0 on fail; `template` because the predicate is project-owned.
- Closes F-4 chain-contradiction specimen: rewrites the guide's `Boundary with observability-essentials` section to the current-shelf reality (essentials v2 dropped its `scope: global` claims on `healthProbes` and `readinessSemantics`; probe-endpoints is the sole claimant on both topics; both orders compose cleanly). The pre-v2 conflict-resolution paths move to a historical migration note.
- Closes F-2 (systemd + TCP transport families with no AC): adds AC-14105-4 (systemd Type=notify: exactly-once READY=1 plus periodic WATCHDOG=1 at cadence; supervisor pull when the watchdog cadence lapses), AC-14105-5 (TCP transport: accept on pass, refuse on fail, zero bytes on the connection), AC-14105-6 (missing platform adapter refused at boot with PROBE_ADAPTER_MISSING).
- Closes the pass-1 lint finding on AC-14106-3: `then` now uses the canonical lowercase `content-length` string owned by TAC-1502.responsibilities[2].
- Re-sweeps every existing AC's `disposition` per section 7b: ACs whose text references profile names, dependency names, or the elicited separate-port option flipped to `template` with `templateFillIns`; the remaining ACs stay `fixed`.
- Review fix pass (register scan): the band-spacing paragraph in `docs/topics.md` reads `shelf-lane`/`shelf lane` so shipped content carries no internal team labels.
