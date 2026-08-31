# Deploy Cloudflare Workers blueprint guide

## What it is

A default deployment floor for small greenfield rcf-lite projects that ship to an edge-runtime target. The blueprint contributes the WHAT of a deployment pattern: how the project declares its deploy shape in a repo-root wrangler manifest, how one Deploy Adapter is the sole caller of the deploy vendor, how every merge to the main branch uploads an artefact version reachable at both a permanent per-version-id URL and a stable preview alias URL, how production only changes when the operator triggers an explicit promote workflow, how rollback rides the same promote path with a prior version id supplied, how every promote runs bounded served-surface probes against the production URL, how local dev-mode is refused as coverage for deployed-scope ACs, and how every uploaded version carries build provenance readable at a fixed health probe.

Concretely, the blueprint ships twelve requirements, twelve user stories (thirty-six acceptance criteria), six architecture components, and five architecture decision records. One ADR is `scope: global` on the `deploymentTarget` topic; the other four are scope-local operational ADRs (default vendor, preview-vs-production URL model, rollback-is-promote posture, dev-mode drift posture) that a composing blueprint does not conflict with by default.

## What it is not

Not a vendor CLI. The default vendor named in ADR-1302 is Cloudflare Workers via the `wrangler` CLI, chosen for the zero-infrastructure floor the rcf-lite tier expects. Larger deployments supersede ADR-1302 with a project-level ADR and swap the adapter's vendor binding for Fly, Vercel, a hyperscaler's FaaS surface, or a project-authored target; the ADR-1301 contract stays intact.

Not a promote-approval workflow. The blueprint mandates that production only changes on an explicit operator trigger; who is allowed to hit the trigger and whether a second reviewer must approve first is a CI-platform authorisation concern that layers above the `workflow_dispatch` primitive. A project that wants two-person integrity on every promote wraps the `promote` workflow in the platform's manual-approval primitive.

Not a canary controller. The vendor's own gradual-rollout primitives (percentage-scoped promotes on Cloudflare's `wrangler versions deploy`, or the equivalent on another vendor) are optional operator patterns above the blueprint. The blueprint mandates the served-surface verifier on the eventual full promote; a project running a percentage rollout invokes the verifier on the final 100% promote and adds its own probe cadence during the ramp.

Not an artefact registry. The deploy vendor's own version-upload primitive IS the artefact store. The blueprint does not introduce a container registry, a bundle archive, or an object-storage-backed release store; a project that wants those authors them above the blueprint.

Not a status page. The observability-essentials blueprint owns `statusPageContract`; this blueprint's deploy-log feeds records into whatever status-page implementation the operator wires above. The blueprint fixes the SHAPE of the deploy-log record, not where the records land or how they are rendered to users.

Not the secrets pipeline. The security-secrets-management blueprint owns `secretsSource`; this blueprint consumes the secrets contract for the vendor API token and any application secret bindings the Worker reads at runtime. A project that has not applied the secrets blueprint authors an equivalent contract themselves; the deploy blueprint's REQ-006 references the contract by shape, not by that blueprint's slug.

## When to reach for it

Reach for the deploy-cloudflare-workers blueprint when:

- The project ships to an edge-runtime target or is willing to fit into one; the runtime model (per-request handler, no long-lived process, bindings for storage and compute) matches what the project needs.
- The default vendor's zero-infrastructure floor is real for the project (no cluster to run, no image registry to feed, no per-region deploy control needed on day one), or the operator is willing to supersede ADR-1302 with a different vendor and swap the adapter's binding.
- The team wants merge-to-preview and explicit-promote-to-production as a durable pattern, not as a discipline held by convention. The blueprint's promote-is-explicit invariant is enforced at the workflow-file level, not at the reviewer's memory.
- Rollback needs to sit on the same ship path as forward promote; the same audit trail, the same secret binding, the same served-surface verifier. An incident is the wrong time to discover a bespoke rollback script has drifted.
- The project is willing to run bounded served-surface probes against the production URL immediately after every promote. A promote that does not verify what it just shipped is not the shape this blueprint contributes.
- The project is a small greenfield rcf-lite deployment (single Worker or a small Worker fleet, one small team or one solo operator, no ops team standing by) where the zero-infrastructure deploy story is a feature.

## When it does not fit

Do not reach for the deploy-cloudflare-workers blueprint when:

- The project runs a long-lived process (a WebSocket server holding thousands of connections, a queue worker with a heavy warm-up, a stateful game server). The Worker runtime is per-request; the blueprint's contract assumes an artefact-upload + explicit-promote model. A project on a long-lived-process shape wants a different deploy target and a different blueprint.
- The project has a hard corporate mandate for a specific hyperscaler and there is no useful default to ship on day one because everything already lives in that hyperscaler. Apply the blueprint anyway if you want the ADR-1301 contract, but expect to supersede ADR-1302 with a project-level ADR at apply time and swap the vendor binding.
- The project requires per-region deploy control finer than what the default vendor's own gradual-rollout primitives support. The blueprint composes cleanly with a canary controller layered above; if the controller is the ship path itself, the blueprint's promote-is-explicit invariant becomes a fit only if the controller wraps the promote workflow rather than replacing it.
- Compliance requires a deploy audit stream shape different from the one the blueprint fixes (a regulator-mandated field set, a specific SIEM schema). The blueprint fixes the SHAPE of the deploy-log record; a project with a stricter schema supersedes the relevant TAC responsibility with a project-level ADR that names the target schema and the mapping.
- The deploy target has no working custom-domain or workers.dev production route (a fully self-hosted stack, an air-gapped deployment). The blueprint's URL model assumes both a preview alias URL and a production URL exist and are distinct hostnames; a fully self-hosted target picks a different blueprint (a future `deploy-docker-compose-vps` blueprint at a different altitude would fit).

An earlier design pass scoped a Fly.io-paired shipping candidate (`deploy-fly-io`) alongside this one under a two-or-none rule for accountBound blueprints. The rule was amended (2026-08-30) from a hard shipping gate to demand-driven direction; a second accountBound deploy blueprint mints when demand arrives. Neutrality is served by the ADR-1301 contract, by the vendor-agnostic adapter port at TAC-1301, and by ADR-1302 explicitly reserving Fly.io, Vercel, hyperscaler FaaS, and self-hosted VPS as promotion paths superseded through a project-level ADR.

## What a good outcome looks like

A project applies the blueprint on a fresh tree, declares its Worker in `wrangler.toml` at the repo root (name, main entry, `compatibility_date`, and every binding the Worker reads), picks its preview alias string (`main` is the common default), realises the six TACs in project-authored FBSes with the default `wrangler`-shelling vendor binding, wires the two GHA workflows from the ship assets, and lands on a deployed application where:

- Every merge to main produces an uploaded Worker version reachable at a stable preview alias URL (say `main-app.example.workers.dev`) and at a permanent per-version-id URL (a hostname prefixed by the vendor's version-id primitive). The `build-and-upload` run's summary carries both URLs and the version id.
- The production URL (say `app.example.com` on a mapped custom domain) is a third, distinct hostname. It continues to serve the previously-promoted version until an operator triggers the `promote` workflow.
- The `promote` workflow runs on `workflow_dispatch` with an optional `versionId` input. Empty defaults to the newest-of-main resolved through the Deploy Adapter's `resolveNewestOfMain`; a hotfix or rollback supplies an explicit version id from `deployAdapter.listVersions()`.
- Every promote runs the Served-surface Verifier against the production URL: at least the `/healthz` probe returning a JSON body whose `versionSha` matches the promoted version's build sha, plus one project smoke probe. A probe breach fails the workflow with `PROMOTE_VERIFY_FAILED` and refuses to mark the release successful.
- Rollback is `promote` with a prior version id supplied. The audit trail is uniform: the same `promotedVersionId`, `promotedBy`, `previousVersionId`, `promotedAt` fields on every promote record, indistinguishable in shape between a forward promote and a rollback.
- The Worker's health probe answers with the commit sha, the build ISO 8601 timestamp, and the CI run URL that produced the version. A single request to `/healthz` on any of the three URL kinds identifies which version is being served without any dashboard step.
- The wrangler manifest is safe to review: no secret value lives in it; every secret binding is declared by name only and populated on the deploy target through the secrets contract. A CI redactor guarantees no log line emits any resolved secret value.
- Tests scoped `deployed` in the RCF coverage tag run against the preview URL, the per-version-id URL, or the production URL; the coverage gate refuses a binding whose target is a dev-mode local URL. Dev-mode remains valid for `runtime`-scope tests and for developer-loop iteration.

## Operator decisions that remain open after apply

- Vendor choice (Cloudflare Workers default, or a superseding project-level ADR selecting Fly.io, Vercel, AWS Lambda, GCP Cloud Run, or a project-authored target). Blueprint owns the contract on both sides of the boundary; project owns the vendor.
- Preview alias string (`main` common default; project-specific names supported). Blueprint owns the alias-URL discipline; project owns the string.
- Production URL shape (custom domain mapped through the vendor, or a workers.dev production hostname on projects without a custom domain). Blueprint owns the constraint that production and preview URLs are distinct; project owns the choice.
- Probe set for the served-surface verifier (the health probe is mandatory; each smoke probe is a project decision informed by the project's own surface). Blueprint owns the retry bounds and the pass criteria; project owns the paths and the expected shapes.
- Health-probe path (`/healthz` common default; project may pick another). Blueprint owns the response-body shape and its role as verifier evidence; project owns the path.
- CI platform (GitHub Actions default, ships as a shipped asset; other platforms adapt the trigger stanzas and input handling). Blueprint owns the workflow behaviour; project owns the platform adaptation.
- Promote authorisation model (the CI platform's own permission model on the manual-trigger primitive, plus any operator-added approval steps). Blueprint owns that promote is an explicit act; project owns who may perform it.
- Deploy-log sink (a JSONL file in a durable location, an audit event bus, a database table, a status-page ingestion source through the observability-essentials blueprint). Blueprint owns the record shape; project owns where records land.
- Rollback-window depth (how many prior versions the operator keeps discoverable through `listVersions`). Blueprint owns that rollback IS a promote; project owns the depth policy.
- Custom-domain provisioning (project-owned; the blueprint does not itself mint DNS or issue TLS). The vendor's own custom-hostname primitive is where the project binds the production URL to a domain it controls.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every ship to production is now a two-step act (merge to main, then an operator-triggered promote) instead of a single-step merge-to-production; the discipline is intentional and adds a small friction to prototype-shaped work where merge-to-production is fine. The default Cloudflare Workers vendor commits the project to an edge-runtime shape; a project whose runtime needs a long-lived process cannot use the default and has to supersede ADR-1302. The served-surface verifier fails CI on real drift; a project that wants faster promotes buys them by tightening the probe set or by accepting a larger risk of a failed promote, neither is free. The three URL kinds (per-version-id, stable alias, production) are three hostnames the project has to reason about; a project that would rather have one hostname loses the class of leaks-through-collapsed-URL the blueprint's ADR-1303 closes. The wrangler manifest becomes a piece of documentation the project maintains as part of its normal change flow; a project that would rather push deploy config into ad-hoc shell scripts loses the manifest's own validation gate. The deploy-log record is a stream the project now maintains; wiring it to a real sink (a status page, a SIEM, a data warehouse) is a project cost the blueprint does not carry. The blueprint says nothing about the vendor's own dashboard workflows, about DNS and TLS provisioning outside the vendor's own custom-hostname primitive, about compliance reporting on deploy events, or about staged canary or blue-green rollouts; a project that needs any of those spends its own build cycles on them and this blueprint does not save it any work there.
