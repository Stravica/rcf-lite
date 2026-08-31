# wrangler.toml shape sample

Reference shape for a Worker that reads a KV namespace, a D1 database, one secret, and serves static assets. Every value with `<...>` is a placeholder the project fills.

```toml
# repo-root wrangler.toml
name = "<worker-name>"
main = "src/worker.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

# production routing (custom domain shown; workers_dev = false because a custom
# domain owns production; the preview alias URL lives on workers.dev regardless)
routes = [
  { pattern = "<production-hostname>", custom_domain = true }
]
workers_dev = false

# static-assets binding
[assets]
directory = "./public"
binding = "ASSETS"

# non-secret vars (populated into env.<NAME> at runtime)
[vars]
LOG_LEVEL = "info"

# KV namespace binding (id filled by the operator; not a secret)
[[kv_namespaces]]
binding = "SESSION_KV"
id = "<kv-namespace-id>"

# D1 database binding
[[d1_databases]]
binding = "APP_DB"
database_name = "<database-name>"
database_id = "<database-id>"

# secret bindings: DECLARE by name only; values are populated on the deploy
# target through the secrets contract (wrangler secret put <NAME>, sourced from
# the project's secrets pipeline). NO secret VALUE lives here.
[secrets]
required = ["SESSION_SIGNING_KEY", "PAYMENT_PROVIDER_TOKEN"]
```

## Reader notes

- `name`, `main`, and `compatibility_date` are the three top-level keys the manifest loader (TAC-1302) refuses to load without. `compatibility_date` must match `\d{4}-\d{2}-\d{2}`.
- Every binding name referenced from `src/worker.ts` (through `env.SESSION_KV.get(...)`, `env.APP_DB.prepare(...)`, `env.SESSION_SIGNING_KEY`, and so on) must appear as a declaration key in this file. The manifest loader's binding-usage scan refuses the build with `WRANGLER_BINDING_UNDECLARED` otherwise.
- Secret binding VALUES never appear in this file. The `[secrets]` block's `required` list declares the names the Worker reads; each value is set on the deploy target through the vendor's secret-set flow, sourced from the project's secrets contract (see the `security-secrets-management` blueprint at slug `security-secrets-management` for the estate default, or the equivalent project-authored pipeline).
- `routes` and `workers_dev` together declare the production URL. When a custom domain owns production, set `workers_dev = false` so the production route is unambiguously the custom domain; the preview alias URL still lives on the workers.dev subdomain regardless of this flag.
- Build-provenance values (`versionSha`, `builtAt`, `ciRunUrl`) are NOT declared here. They are injected into the built bundle by the `build-and-upload` workflow (see `assets/ci-workflows/build-and-upload.yml.md`).
