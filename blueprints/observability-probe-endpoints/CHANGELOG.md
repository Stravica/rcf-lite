# observability-probe-endpoints CHANGELOG

## 1.2.3 - 2026-09-11

Third fix pass (criterion e closure-3). Fixture profile-registry materialises the SIX shipped profile names named on AC-14103-1 (kubernetes, loadBalancer, uptimeMonitor, systemd, dockerHealthcheck, reverseProxy) with each carrying transport, path/command/notify surface, responseContract and semanticModel; resolveProfile('kubernetes', { startup: { enabled: true } }) supports the AC-14102-4 startup-enabled shape. refuseIfPartial now throws with a stable PROBE_PROFILE_INCOMPLETE code and a missingKey property. profile-boot-materialisation uses resolveProfile('kubernetes'); partial-profile-refusal exercises stripped-transport and startup-missing-startup-path refusals AND every shipped profile's shape (AC-14103-1) AND the loadBalancer singleHealthSignal semantic (AC-14103-3). Materialiser teardown propagates callback errors.


## 1.2.2 - 2026-09-11

Adds a contributions/probes/ pack (profile-boot-materialisation, kubernetes-startup-enabled, partial-profile-refusal) with a fixture-side profile registry + node:http materialiser under packages/rcf-lite/test/fixtures/probe-pack-observability-probe-endpoints/. Materialises the kubernetes-request-listener and kubernetes-startup profiles on 127.0.0.1, drives real HTTP GETs against declared paths, asserts the startup-phase flip from 503 to 200, and refuses partial profiles at boot with a named missing key. No account gate.
Fix pass on this patch: profile-registry fixture returns body.status=pass on liveness/readiness and pass/fail on startup per AC-14102-1/3/4 (no more live/ready/starting body strings); kubernetes-startup-enabled re-anchors to AC-14102-4; partial-profile-refusal re-anchors refusal rows to AC-14103-2 and the well-formed acceptance to AC-14103-1; every detail line starts with the first eight words of the anchored AC text.



Fix pass (2026-09-11, criterion e closure): profile-boot-materialisation now reads AND records the Response objects (headers with echoed x-request-id, body excerpts). kubernetes-startup-enabled varies request-id per call and asserts fixture echoes it. All probes vary inputs and assert derived outputs.

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
