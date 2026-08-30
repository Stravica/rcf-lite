# Security secrets management blueprint (v1.0.0)

The eighth content blueprint on the rcf-build-lite blueprint mechanism. Scope: a vendor-agnostic secrets management contract centred on a repo-root `secrets.yaml` manifest, a single Secrets Manager client every call site imports, least-privilege per-deployable slices, a durable metadata-only audit trail, an agent-safe piped-stdin CLI, `.env` as an ephemeral regenerable reflection, an environment-aware manifest shape elicited from the operator, and a three-way elicited operator UI choice. Targeted at small greenfield rcf-lite projects; larger deployments supersede the default vendor (ADR-902) with a project-level ADR and swap the vendor adapter.

## Apply

```
rcf define blueprint add <path-to>/blueprints/security-secrets-management
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry grouped under the `security` category; `rcf define blueprint remove security-secrets-management` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, category `security`, and the 30 contributions with scope/topic on the one global ADR |
| Doc set | `contributions/` | 10 REQs, 10 USs (30 ACs), 5 TACs, 5 ADRs, all schema-valid and namespaced (`security-secrets-management-REQ-001` prefix family; `ADR-901-security-secrets-management-secrets-source` suffix family) |
| Manifest shape sample | `assets/manifest-samples/secrets-yaml-shape.md` | The exact shape of a `secrets.yaml` entry with `environments`, `deployables`, `secrets[]`, and `uiIntegration`, worked as one committable example |
| Environment-aware example | `assets/manifest-samples/environment-aware-example.md` | Two shapes of the environments section (three-env `dev/ci/live` and a project-specific list) with a pick guide |
| Agent access pattern | `assets/cli-usage/agent-access-pattern.md` | The piped-stdin pattern for `secrets read` and `secrets put`, including a Node.js spawn wrapper that keeps the value off argv and off any log line |
| UI three-way choice | `assets/ui-integration/three-way-choice.md` | The elicitation script for the admin-UI choice with the shape of each outcome and the field contract for the `integrate` variant |
| Guide | `guide/security-secrets-management.md` | Operator-facing: when to use it, when not, what stays your call, and the promotion signals for the hosted-vendor and admin-SPA companion blueprints |
| Coordination vocabulary | `docs/topics.md` | The one global-topic string this blueprint contributes and the shared id band registry (application-spa, application-api-rest, security-auth-magic-link, hello-panel, persistence-data-sqlite, ci-pipeline, observability-essentials, security-secrets-management) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the manifest shape, the client contract, the least-privilege posture, the audit shape, the agent access discipline, the `.env` reflection posture, the rotation gate, the UI-choice contract); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: a vendor SDK (the default vendor is named in ADR-902 as SOPS+age, the shape of the vendor adapter is fixed by TAC-901, the actual adapter code is a project-authored implementation); a specific manifest schema library (any YAML parser plus the loader in TAC-902 satisfies the loader responsibilities); a project's authorisation model (secrets management authorises READ of secret material; who is allowed to act on which secret at which UI surface is a project-side authorisation concern layered above the audit sink); a rotation orchestrator (the blueprint gates on rotation age at CI, it does not itself run the rotation for you; running the rotation is a project-authored procedure the vendor's own tooling supports); the admin-UI Secrets page itself when `uiIntegration.mode` is `integrate` (the field contract is fixed by TAC-905, the page implementation lives in the host project); an admin-spa blueprint (a companion future blueprint, promotion signal noted in the guide); a project's audit-storage engine (the blueprint fixes the event shape, not where the events land).

## The one global decision

ADR-901-security-secrets-management-secrets-source ships `scope: global` on topic `secretsSource`. This is the project's single source of truth for secret material: a repo-root manifest plus a vendor-agnostic client. A composing blueprint that wants a vendor-committed shape (a Vault-specific blueprint, an AWS Secrets Manager blueprint) conflicts here by design and expects a project-level ADR resolution. Vendor DEFAULT (ADR-902) is deliberately scope-local: the contract is global; the default that ships behind it is not.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from vendor-choice (which is not global), and the AC id band allocation (security-secrets-management owns 8101-8899, ADR/TAC suffix block 9xx).

## Quality bar

Repo-root `secrets.yaml` as the sole declaration of every secret the project depends on; one Secrets Manager client as the sole importer of the vendor binding on the boundary; per-deployable declared slice enforced at both the client and the vendor-side credential scoping; loud-fail-at-boot on a required-absent secret with a stable-coded error naming the logical name and active environment; single-shot audit event per fetch attempt with metadata-only fields; agent access via piped-stdin CLI that refuses value-on-argv and refuses TTY-echo-without-`--show`; CLI structured surfaces (`--json`, `--report`) that never carry a value; CLI log stream wrapped in a redactor that replaces resolved values with a fixed placeholder before any bytes leave the process; `.env` as an atomically-written gitignored regenerable reflection with a source-tree scan refusing direct `.env` reads at boot; environment-aware manifest with the environment set elicited at first apply and enforced thereafter; CI rotation gate that fails on expired-age and unknown-age entries and audits every applied override; three-way elicited UI choice (`integrate`, `admin-spa`, `none`) with a field contract that renders metadata only, never a value. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (source-tree import-graph scans for the boundary properties, in-memory audit-sink accumulation for the audit shape, port-scan for the fail-safe boot posture, byte-equality checks against resolved values for the leakage properties, CI-gate exit code for the rotation and manifest-miss gates, page-render inspection for the UI-choice outcomes). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational surface a project must own on its own is the vendor adapter implementation (the SOPS-with-age default, or a superseding vendor's adapter); that responsibility is stated as a TAC interface, not as a smuggled runtime probe. The one AC whose runtime observability depends on operator choice is AC-8110-3 (`uiIntegration.mode: 'none'` outcome); the runtime observability there is the absence of a Secrets page anywhere in the deployed application, which a project's own smoke scan can confirm cheaply.
