# Security secrets management blueprint guide

## What it is

A default secrets-management floor for small greenfield rcf-lite projects. The blueprint contributes the WHAT of a secrets pattern: how the project declares what secrets exist, how one client is the sole reader of every value, how each deployable is restricted to its own slice, how every access is audited, how coding agents work with values without leaking them into transcripts and logs, how `.env` sits at the surface as an ephemeral projection rather than the source of truth, how environment shape is elicited from the operator, how rotation is gated at CI, and how an operator-facing Secrets page is offered as a three-way elicited choice.

Concretely, the blueprint ships ten requirements, ten user stories (thirty acceptance criteria), five architecture components, and five architecture decision records. One ADR is `scope: global` on the `secretsSource` topic; the other four are scope-local operational ADRs (default vendor, agent access discipline, `.env` reflection posture, rotation-and-audit posture) that a composing blueprint does not conflict with by default.

## What it is not

Not a vendor SDK. The default vendor named in ADR-902 is SOPS with age keys, chosen for the zero-infrastructure floor the rcf-lite tier expects. Larger deployments supersede ADR-902 with a project-level ADR and swap the vendor adapter for Vault, a cloud secrets manager, or a hosted third-party service; the ADR-901 contract stays intact.

Not an authorisation model. The blueprint governs READ of secret material and the audit trail of that read; who is allowed to trigger a rotation, who sees the admin-UI Secrets page, and who owns which secret at the operational level are project-side authorisation concerns that layer above the audit sink.

Not a rotation orchestrator. The blueprint gates on rotation age at CI, it does not itself run the rotation. Running a rotation is a project-authored procedure the vendor's own tooling supports (SOPS re-encrypt, Vault's rotate endpoint, a cloud provider's rotation trigger); the blueprint's rotation gate then registers the fresh `lastRotatedAt` next time it runs.

Not a UI framework. When `uiIntegration.mode` is `integrate`, the field contract for the Secrets page is fixed (TAC-905's structured output surface) but the page implementation lives in the host project's admin UI. A future admin-SPA blueprint (unshipped at v1.0.0, promotion signal: the third project asks for a self-contained admin surface that hosts this page alongside others) will cover the standalone case.

Not a config manager. Non-secret configuration (feature flags, tunable thresholds, endpoint URLs that are not sensitive) sits outside this blueprint; the manifest is for secret material only. A project that wants a unified config surface authors that on top; it does not belong here.

## When to reach for it

Reach for the security-secrets-management blueprint when:

- The project depends on secret material of any kind (third-party API keys, database credentials, signing keys, session salts, TLS keys) and there is no single source of truth for what secrets exist.
- Multiple deployables share a secret pool and least-privilege slicing is the intended posture rather than a wishful comment in a README.
- Coding agents (Claude, Cursor, Copilot workflows, in-house LLM-driven scripts) are part of the operator's day and secret material must not land in the surfaces those workflows create.
- Rotation is a real policy rather than a document nobody reads; CI is the intended enforcement layer.
- The project is a small greenfield rcf-lite deployment (single deployable or a small deployable fleet, one small team or one solo operator, no ops team standing by) where a zero-infrastructure secrets story is a feature.

## When it does not fit

Do not reach for the security-secrets-management blueprint when:

- The project's secret pool is genuinely trivial (one API key, one deployable, one operator) and running a manifest plus a CI gate is more machinery than the actual risk warrants. A lightweight `.env` and a rotation reminder on a calendar is honestly the right shape at that scale; this blueprint's audit-and-slice discipline is overkill.
- The project has a hard corporate mandate for a specific hosted secrets vendor and there is no useful default for day one because everything already lives in that vendor. Apply the blueprint anyway if you want the ADR-901 contract, but expect to supersede ADR-902 with a project-level ADR at apply time.
- Compliance requires an audit stream shape different from the one ADR-905 fixes (a specific SIEM schema, a regulator-mandated field set). The blueprint fixes the SHAPE of the audit events; a project with a stricter schema supersedes ADR-905 with a project-level ADR that names the target schema and the mapping.
- The deploy target has no persistent filesystem for the SOPS-with-age default to live on and no working alternative vendor. The default vendor assumes a stable path the encrypted files survive at; a project without that assumption picks a different vendor (a hosted service is the natural fit) and supersedes ADR-902 accordingly.

The design brief `w-2026-08-30-dave-008` originally scoped a Vault-first blueprint (candidate name `secrets-vault`). The blueprint at v1.0.0 does not lead with Vault because the container-plus-server cost is disproportionate for the rcf-lite tier this blueprint targets. Vault remains the reference open-source promotion path for projects with dedicated ops capacity, and the blueprint's contract composes cleanly with a Vault vendor adapter; the promotion is a project-level ADR supersede on ADR-902 and an adapter swap.

## What a good outcome looks like

A project applies the blueprint on a fresh tree, elicits its environment set (say `dev`, `ci`, `live`), declares its deployables and their per-deployable secret slices in `secrets.yaml`, chooses one of the three UI outcomes (`integrate`, `admin-spa`, `none`), realises the five TACs in project-authored FBSes with the default SOPS-with-age vendor adapter, and lands on a deployed application where:

- Every runtime path that reads a secret imports the Secrets Manager client; nothing else touches the vendor SDK. A source-tree scan confirms the boundary.
- The `secrets.yaml` at the repo root is the file the operator reads to see what secrets the project depends on; adding a new secret is a two-step change (add the manifest entry, then commit an encrypted value file or configure the vendor path).
- A required secret missing in `live` fails boot with a stable-coded error naming the logical name and the environment; the operator diagnoses in one step.
- A coding agent that needs to wire a secret into a starting process runs `secrets read N | consumer-tool` and the value never lands in the agent's transcript, its tool log, or a scratch file on the working tree.
- A developer laptop `.env` exists because the developer ran `secrets reflect --deployable local-api --env dev`; deleting the file and re-running the reflector produces an identical file; the file is gitignored and its stale-and-regenerable status is visible in the workflow.
- The rotation gate runs on every CI change; a secret past its `rotationDays` budget fails the run with a naming error the author can act on immediately; a legitimate mid-rotation override is authored with an expiry timestamp and every application of it is audited.
- The audit stream contains every fetch attempt with `name`, `path`, `environment`, `principal`, `outcome`, and `at`; a byte-equality scan against every resolved secret value finds no match anywhere on the stream.
- When the operator picked `integrate`, the admin UI's Secrets page renders name, environment, owner, `lastRotatedAt`, and `rotationDays` per row; no cell renders a secret value. When the operator picked `none`, no Secrets page exists anywhere on the deployed application; the CLI plus the audit stream are the whole story.

## Operator decisions that remain open after apply

- Vendor choice (SOPS+age default, or a superseding project-level ADR selecting Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Doppler, Infisical, or a project-authored adapter). Blueprint owns the contract on both sides of the boundary; project owns the vendor.
- Environment set (`dev`/`ci`/`live` common default; project-specific names supported). Blueprint owns the enforcement that the manifest and the boot input agree; project owns the names.
- Deployable-to-slice map (which deployable reads which secrets). Blueprint owns the least-privilege enforcement; project owns the split.
- UI integration outcome (`integrate`, `admin-spa`, `none`). Blueprint owns the field contract for the `integrate` outcome; project owns the page implementation and the admin UI it lives in.
- Rotation-days budgets per entry (a small budget for high-turnover keys, a larger budget for session salts). Blueprint owns the CI gate that enforces the budget; project owns the numbers.
- Rotation override policy (who is allowed to author an override, how long an override may last, what the audit review cadence is). Blueprint owns that overrides carry an `expiresAt` and are audited every time; project owns the human process around them.
- Audit sink implementation (where the audit events land: a local file, a SIEM, a data warehouse, a project's own event bus). Blueprint owns the event shape; project owns the shipper.
- Secret owners (who is on the hook when an entry expires or an incident touches its blast radius). Blueprint owns that the manifest carries an `owner` field per entry; project owns the roster.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every new secret is now a manifest change and a vendor-side configuration change instead of a stray environment variable; the discipline is intentional and adds a small friction to prototype-shaped work. The default SOPS-with-age vendor requires every developer laptop and every CI runner and every deploy host to hold an age key; losing every copy is a recover-by-rewrite problem for a pre-launch project and a recover-by-re-issue problem thereafter. The rotation gate fails CI on real drift; a project that wants faster merges buys them by rotating on cadence or by keeping the override discipline honest, neither is free. The audit sink is a stream the project now maintains; wiring it to a real sink (a SIEM, a data warehouse) is a project cost the blueprint does not carry. The three-way UI choice keeps a project without a UI honest, but a project that later wants one is a real build task rather than a config flip. The blueprint says nothing about authorisation, about the vendor's own rotation orchestration, about SIEM schemas, or about compliance reporting; a project that needs any of those spends its own build cycles on them and this blueprint does not save it any work there.
