# Observability probe endpoints blueprint guide

## What it is

A default probe-surface blueprint for rcf-lite projects that must integrate with an EXTERNAL supervising system whose conventions drive the probe wire shape. The blueprint contributes the WHAT of a probe pattern: how the operator declares which external supervisor the service runs under (`kubernetes`, `loadBalancer`, `uptimeMonitor`, `systemd`, `dockerHealthcheck`, `reverseProxy`, or a project-authored `custom:<name>`), how each profile fixes the probe transport, path or command surface, response contract, and semantic distinction between liveness and readiness for that supervisor, how a fused-listener default coexists with a `probeListener.separatePort` opt-in for probe-traffic isolation, how the auth-exempt list stays scoped to the resolved probe path set exactly, and how switching supervising systems is a configuration change rather than a source-tree reshape.

Concretely, the blueprint ships eight requirements, eight user stories (twenty-four acceptance criteria), four architecture components, and five architecture decision records. Two ADRs are `scope: global` on the topics `healthProbes` (the profile-elicited probe interface) and `readinessSemantics` (per-profile readiness aggregation); the other three are scope-local (Kubernetes default profile, separate-port option, external-response secrecy rule). The two global ADRs conflict with the observability-essentials sibling by design; see 'Boundary with observability-essentials' below.

## What it is not

Not an all-in-one observability floor. There is no public status page here, no notification outcome sink, no metrics-export surface, no distributed-tracing surface, no authenticated operator dashboard. observability-essentials is the blueprint for the self-supervised all-in-one case; this one exists for the case where the external supervising system's conventions come first.

Not a readiness-check implementation. The blueprint fixes the SHAPE of the readiness predicate boundary (a synchronous function returning pass or fail, reading state a project-supplied evaluator maintains on its own cadence) and each profile's default aggregation rule. The per-dependency check code and the evaluator implementation are project-authored.

Not a supervisor-specific SDK. The blueprint holds no SDK dependency on Kubernetes, no client library for a specific cloud load balancer, no wrapper around a specific uptime-monitor API. The profile contract shapes the wire surface; the project brings whichever integration bits it needs on the outside of the boundary.

Not an auth middleware. The blueprint emits an exact-match exempt-path list the project's own auth middleware installer consumes. The middleware installer, the auth model itself, and the check code stay project-side; the exemption is a boundary contract, not a middleware implementation.

Not a listener library. The topology component (TAC-1503) accepts a project-supplied `userTrafficListener` and a project-supplied `listenerFactory` for the separate-port case. The blueprint holds no opinion on the HTTP server library (Node HTTP, Express, Hono, Fastify, or the Worker-style edge platform's own router).

## Boundary with observability-essentials

observability-essentials and observability-probe-endpoints are BOTH `observability` category blueprints. They answer different questions:

- **observability-essentials** targets the self-supervised, all-in-one case: the project owns its observability surface end to end, wires two HTTP JSON probes (`/healthz`, `/readyz`) on the request-traffic listener with a stable body shape, ships a public status page for external readers, and ships a notification outcome sink for durable notification records. The audience of the probe body is the operator inspecting the deployed service in triage. The identity is 'a default observability floor'.

- **observability-probe-endpoints** targets the external-integration case: the service runs under a specific external supervising system (a Kubernetes kubelet, an application load balancer, an uptime monitor, a systemd unit, a Docker HEALTHCHECK invocation, a reverse-proxy upstream health check), and the wire shape of the probes follows that supervisor's conventions. The audience of the probe response IS the external supervisor; the response is minimal by construction so the surface never carries reconnaissance value to unintended readers. The identity is 'make your service correctly probeable by whatever external system supervises it'.

Composing the two on one project fires two `globalAdrTopic` conflicts (on `healthProbes` and on `readinessSemantics`) on purpose. The four documented resolution paths per topic apply: adopt the incoming blueprint (remove the existing), keep the existing (do not add the incoming), author a project-level ADR that supersedes both, or declare the resolution on the add itself with `--resolve`. The right resolution is usually one of two shapes:

- **Shape A (external supervisor wins):** the project runs under a supervisor whose conventions drive the wire shape; a project-level ADR fixes both topics against the probe-endpoints model and observability-essentials contributes the public status page and notification outcome sink through the compose while keeping its `statusPageContract` topic untouched.
- **Shape B (self-supervised wins):** the project designs its own observability floor without a specific external supervisor's conventions in view; a project-level ADR fixes both topics against the essentials model and this blueprint is not applied.

Explicit hybrids exist (an internal essentials-shaped surface for one audience and a profile-shaped external surface for the supervising system) and are legitimate; the project-level ADR names both surfaces with explicit boundaries and both blueprints compose.

Composing with the `deploy-cloudflare-workers` blueprint is a separate concern: that blueprint mandates its own build-provenance probe (`/healthz` by convention) whose response body carries `{ versionSha, builtAt, ciRunUrl }` for the deploy verifier's reconciliation, which is incompatible with every profile's minimal response contract; the two surfaces coexist on distinct paths (this blueprint's profile-owned path stays minimal, the deploy blueprint's provenance path lives on a separate string), and the boundary is documented on the deploy side in `assets/verification/served-surface-probes.md`.

## When to reach for it

Reach for the observability-probe-endpoints blueprint when:

- The service runs under a specific external supervising system (Kubernetes, cloud load balancer, uptime monitor, systemd unit under `Type=notify`, Docker HEALTHCHECK invocation, reverse-proxy upstream health check) whose conventions drive what a probe looks like and what the answer means.
- The probe surface is reachable by parties beyond the intended supervisor (a fused-topology deployment where the public host resolves to the same port that answers probes), and the response contract must be minimal to keep reconnaissance value low.
- Multi-environment deployments switch supervising systems across environments (a `dev` environment on Docker Compose with a load-balancer-shaped health check, a `live` environment on Kubernetes with liveness and readiness); a configuration change per environment is the intended migration path.
- The probes are one integration surface among several the service exposes; other observability concerns (public status page, notification outcomes, metrics export, tracing) belong to other blueprints and stay out of scope here.

## When it does not fit

Do not reach for the observability-probe-endpoints blueprint when:

- The project is a self-supervised all-in-one deployment where a single opinionated observability floor is the intended shape; observability-essentials is the right pick.
- The service is not probed by an external supervisor at all (a batch job with no supervising loop, a one-shot script, an internal-only tool without a health-check consumer). The blueprint's elicitation surface has nothing to fix in that case.
- The probes need to expose richer per-dependency state on the wire for a specific supervising system that reads it (an OpenTelemetry-agent-scrape shape, a gRPC-health-with-service-name shape). The blueprint's default profile set does not cover those; a `custom:<name>` profile is the mechanism escape, or a project-level ADR supersedes ADR-1501 and the project authors the richer surface directly.
- The project already has a project-level `healthProbes` ADR the operator wants to keep; applying this blueprint would fire a conflict the operator does not want to resolve. Not applying the blueprint is a legitimate outcome.

The round-2 shelf brief originally scoped this blueprint as a `kubernetes-service` deployment-shape blueprint, then reshaped it during review into `observability-probe-endpoints` (a probe-surface blueprint for any external supervising system, with Kubernetes as the shipped default). The reshape moves the identity from 'ship on Kubernetes' to 'be probeable by whichever supervisor probes you'; the boundary with observability-essentials (self-supervised all-in-one) came out of that reshape too. A future `deploy-kubernetes` blueprint in the `deploy` category may take on the deployment-manifest side of the original candidate; this one is the probe-surface side.

## What a good outcome looks like

A project applies the observability-probe-endpoints blueprint on a fresh tree, declares its `probeInterface.profile` value for each environment, wires the readiness predicate against its declared dependency evaluator, chooses fused topology or `probeListener.separatePort` per environment, realises TAC-1501 through TAC-1504 in project-authored FBSes, and lands on a deployed service where:

- A Kubernetes-supervised pod on the shipped default answers HTTPGet `/live` and `/ready` on the container's request-traffic port; the standard `livenessProbe: { httpGet: { path: /live, port: <containerPort> } }` and `readinessProbe: { httpGet: { path: /ready, port: <containerPort> } }` on the podspec work without further wiring.
- A load-balancer-supervised container on the `loadBalancer` profile answers one HTTP GET at the resolved `/health` path with the status code alone and an empty body; the LB target-group health check sees the status flip within its own health-check interval budget and pulls the target from rotation without ambiguity from a body it never read.
- A systemd-supervised process on the `systemd` profile emits `sd_notify(READY=1)` after boot and `sd_notify(WATCHDOG=1)` on the configured watchdog cadence; the unit under `Type=notify` starts cleanly and stays healthy under the watchdog timeout.
- A Docker HEALTHCHECK on the `dockerHealthcheck` profile exits 0 on pass and non-zero on fail from the exec entry point the profile exposes; the container's HEALTHCHECK status flips as `docker inspect` reports.
- A separate-port Kubernetes deployment on `probeListener.separatePort: 9091` exposes only the traffic port on the Service; probes reach the pod on port 9091 from the kubelet on the pod network and never appear on the public interface.
- An unauthenticated GET against `/live` or `/ready` on the auth-installed listener answers without a credential challenge; an unauthenticated GET against `/ready/next` (a path adjacent to the exempt entry but not exempt itself) returns the middleware's normal unauthenticated response; the exemption never expanded beyond the resolved probe path set.
- A response body scan against every profile's response finds no dependency name, no environment identifier, no hostname, no replica id, no build hash, no commit sha; the pass or fail answer is the whole response surface.
- Switching a service from Kubernetes to a Docker Compose deployment behind a load balancer is a change to `probeInterface.profile` in configuration; a source-tree diff between the two boots contains no non-configuration changes and no per-profile conditional appears outside the profile modules and the resolver call site.

## Operator decisions that remain open after apply

- Target integration profile (`kubernetes` default; `loadBalancer`, `uptimeMonitor`, `systemd`, `dockerHealthcheck`, `reverseProxy` supplied; `custom:<name>` slot for project-authored profiles). Blueprint owns the profile contract shape; project owns the per-environment selection.
- Probe path defaults (`/live` and `/ready` for Kubernetes, `/health` for load balancer, per-profile defaults elsewhere). Blueprint owns the defaults; project overrides at boot for compliance with a particular supervisor convention or platform mandate.
- Listener topology (fused user-traffic listener default, `probeListener.separatePort: <N>` opt-in). Blueprint owns the two shapes; project owns the per-environment choice.
- Readiness predicate implementation (the per-dependency check code, the evaluator cadence, the timeout budgets). Blueprint owns the predicate boundary and each profile's default aggregation rule; project owns the checks and the cadence values.
- Custom profile authoring (a project that authors `custom:<name>` supplies the profile object against the shipped contract). Blueprint owns the contract; project owns the profile.
- Auth middleware installer (the project supplies the installer that consumes the exempt-path list the topology component emits). Blueprint owns the exempt-list shape; project owns the middleware and the installer.
- systemd watchdog cadence, Docker HEALTHCHECK interval, TCP probe port. Blueprint owns the transport shape; project owns the cadence and interval values.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every process pays the profile-resolver step at boot and one indirection through the frozen profile object at each probe binding site; the cost is small but real. A project that wants hot-reload of the profile selection restarts the process gracefully; the blueprint declines to support live rebinding. The separate-port topology opens a second HTTP listener when in effect; the extra port is a small memory cost and one more thing to think about in the deployment substrate. The profile-swap-is-config invariant costs the project a small amount of author discipline: per-profile branching in the boot path outside the resolver call site would defeat the invariant, and the AC scan catches the drift only if the project wires it into its own CI. The response-minimalism-by-construction rule costs the project any richer probe body it may have wanted for its own consumption (that surface belongs to observability-essentials, to an authenticated dashboard, or to a project-side triage endpoint outside the probe path set). The blueprint says nothing about the public status page, the notification outcome sink, metrics export, distributed tracing, or the auth model itself; a project that needs any of those spends its own build cycles on them and this blueprint does not save it any work there.
