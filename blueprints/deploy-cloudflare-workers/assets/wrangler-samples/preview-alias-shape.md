# Preview alias and per-version URL patterns

Reference shape for the three URL kinds this blueprint mandates. Every value with `<...>` is a placeholder the operator fills; no real hostname appears here.

## The three URL kinds

Given a Worker named `<worker-name>` on an account whose workers.dev subdomain is `<subdomain>` and a production custom domain of `<production-hostname>`, the Deploy Adapter's `deploy status` surfaces three URLs:

| Kind | URL pattern | Changes on | Purpose |
|---|---|---|---|
| Per-version-id URL | `<version-prefix>-<worker-name>.<subdomain>.workers.dev` | Every upload assigns a new one; the URL for a given version is permanent | Pin a change-review link to a specific version id; never rots |
| Stable preview alias URL | `<alias>-<worker-name>.<subdomain>.workers.dev` | Never (points at a moving target: the newest-of-`<alias>`) | Persistent shareable review surface for stakeholders |
| Production URL | `<production-hostname>` (or `<worker-name>.<subdomain>.workers.dev` when no custom domain) | Only on an explicit `promote` workflow | User-facing traffic |

The alias string is operator-chosen; `main` is the common default when the operator wants "the newest of the main branch" as the persistent preview. A project running multiple long-lived branches can allocate additional aliases (`staging`, `next`), each fixed to the newest-of-that-branch upload.

## The upload verb

```
wrangler versions upload --preview-alias <alias>
```

Uploads the current build as a new version. Assigns a version id and returns two URLs on stdout: the per-version-id URL (unique per upload, permanent) and the stable preview alias URL (fixed to `<alias>`, always pointing at the version this upload just produced). The uploaded version does NOT serve production traffic; only the promote verb changes production.

## The promote verb

```
wrangler versions deploy <version-id>
```

Routes production traffic to the named version id. Requires the version id to be present in `wrangler versions list`. The blueprint's promote workflow calls this verb through the Deploy Adapter after resolving the version id from either the input `versionId` field or from `wrangler versions view <alias>` when the input is empty.

## The rollback verb

Rollback IS a promote of a prior version id. The blueprint's Deploy Adapter surfaces one path (`promoteVersion`); the vendor's convenience shortcut `wrangler rollback [<version-id>]` is optional operator documentation for a break-glass path that bypasses the deploy-log record and the served-surface verifier. Do not use it as the recorded ship path.

## Reader notes

- The exact `<version-prefix>` string the vendor uses in the per-version-id URL is a vendor implementation detail; the operator does not name it. The URL is the whole shape; the adapter's `describeVersion` returns it verbatim.
- The alias URL host segment is a function of the alias string; the alias `main` produces the host segment `main-<worker-name>`. The Preview URL Resolver (TAC-1303) refuses an alias whose assembled host would equal the production URL host; a manifest that would collapse them refuses to load.
- The production URL is derived from the wrangler manifest's `routes`/`route`/`workers_dev` block. When a custom domain owns production, the vendor's own custom-hostname primitive is what binds the domain to the Worker; the blueprint does not itself provision DNS or issue TLS.
