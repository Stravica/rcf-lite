# wrangler.toml shape sample

Reference shape for a Worker that reads a KV namespace, a D1 database, a set of secrets, and serves static assets behind an auth gate. Every value with `<...>` is a placeholder the project fills. Two production-URL branches are shown, custom-domain and workers.dev-only; pick one, delete the other.

```toml
# repo-root wrangler.toml
name = "<worker-name>"
main = "src/worker.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

# --- production routing: pick ONE branch ---

# Branch A: custom domain owns production (workers_dev = false so production
# is unambiguously the custom domain; the preview alias URL still lives on
# workers.dev regardless).
routes = [
  { pattern = "<production-hostname>", custom_domain = true }
]
workers_dev = false

# Branch B (workers.dev-only, no custom domain): production is
# <worker-name>.<subdomain>.workers.dev, where <subdomain> is the account's
# workers.dev subdomain. Discover it via the CF REST API (see
# `preview-alias-shape.md` under `Discovering the workers.dev subdomain`);
# do NOT hardcode.
# workers_dev = true
# (delete the `routes = [...]` block above when using Branch B)

# --- static-assets binding ---
# The assets pipeline serves any file under `directory` at its file-path
# BEFORE the Worker's fetch handler runs. That means `./public/notes.html`
# is reachable at `/notes` and at `/notes.html` from the edge cache with
# no code executing. On any Worker with an auth gate, that ordering
# silently bypasses the gate for any collision path.
#
# `run_worker_first` is the switch that inverts the ordering: for every
# listed path (glob-matched), the fetch handler runs FIRST and the assets
# pipeline is a fallback. Set it whenever the Worker gates access to
# anything a static-file path could shadow.
[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = [
  "/api/*",
  "/<auth-gated-path-1>",
  "/<auth-gated-path-2>"
]

# --- non-secret vars (populated into env.<NAME> at runtime) ---
[vars]
LOG_LEVEL = "info"

# --- KV namespace binding (id filled by the operator; not a secret) ---
[[kv_namespaces]]
binding = "SESSION_KV"
id = "<kv-namespace-id>"

# --- D1 database binding ---
[[d1_databases]]
binding = "APP_DB"
database_name = "<database-name>"
database_id = "<database-id>"

# --- Secret bindings: NO DECLARATION BLOCK IN THIS FILE ---
# wrangler 4.x has no top-level `[secrets]` key. Secret binding NAMES
# are declared implicitly by the Worker code reading `env.<NAME>`; the
# vendor's pre-flight refuses `wrangler deploy` when a referenced secret
# has not been set on the target Worker. See `bootstrap-vs-steady-state.md`
# for the first-deploy path (`wrangler deploy --secrets-file <tmp>`) and
# the steady-state path (`wrangler secret put <NAME>` from CI).
#
# A project that wants a human-readable manifest of required secrets can
# maintain one in a README section or a project-owned `SECRETS.md`; that
# manifest is intent-documentation and is NOT vendor-parsed.
```

## Reader notes

- `name`, `main`, and `compatibility_date` are the three top-level keys the manifest loader (TAC-1302) refuses to load without. `compatibility_date` must match `\d{4}-\d{2}-\d{2}`.
- Every binding name referenced from `src/worker.ts` (through `env.SESSION_KV.get(...)`, `env.APP_DB.prepare(...)`, `env.<SECRET_NAME>`, and so on) must appear as a declaration key in this file OR as a secret set on the Worker via the vendor's secret-set flow. The manifest loader's binding-usage scan refuses the build with `WRANGLER_BINDING_UNDECLARED` when a non-secret binding is missing; the vendor's pre-flight refuses the deploy when a secret is missing on the target.
- **Assets-binding auth-gate discipline (security-class).** The `[assets] run_worker_first` list is load-bearing whenever the Worker gates access to any path that a static file under `directory` could shadow. Without it, a request to `/<gated-path>` is answered from `./public/<gated-path>.html` (if the file exists) BEFORE the fetch handler runs; the auth check is silently bypassed. The manifest loader flags a manifest that declares `[assets]` and a fetch handler with an auth middleware but no `run_worker_first` entries covering the middleware's protected routes; a project unsure which routes to list defaults to `run_worker_first = ["/*"]` and accepts serving static assets only under `not_found_handling`.
- Secret binding VALUES never appear in this file. There is no `[secrets]` block in wrangler 4.x; the vendor treats every `env.<NAME>` reference from Worker code as an implicit binding declaration and enforces its presence at deploy time. Values arrive on the Worker via the vendor's secret-set flow (see `bootstrap-vs-steady-state.md`) sourced from the project's secrets contract (see the `security-secrets-management` blueprint at slug `security-secrets-management`, or the equivalent project-authored pipeline).
- `routes` and `workers_dev` together declare the production URL. Branch A (`workers_dev = false` with a `routes = [...]` custom-domain entry) is the shape for projects that own a custom domain. Branch B (`workers_dev = true`, no `routes`) is the shape for greenfield workers.dev-only projects; production is then `<worker-name>.<subdomain>.workers.dev` and the Deploy Adapter discovers `<subdomain>` at boot rather than hardcoding it.
- Build-provenance values (`versionSha`, `builtAt`, `ciRunUrl`) are NOT declared here. They are injected into the built bundle by the `build-and-upload` workflow (see `assets/ci-workflows/build-and-upload.yml.md`). The `versionSha` served on the health probe is the git commit sha (`github.sha`), NOT the vendor-assigned version UUID; see `served-surface-probes.md` for the distinction.
