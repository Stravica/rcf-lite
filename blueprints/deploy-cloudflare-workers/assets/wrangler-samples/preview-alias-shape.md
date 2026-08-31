# Preview alias and per-version URL patterns

Reference shape for the three URL kinds this blueprint mandates. Every value with `<...>` is a placeholder the operator fills; no real hostname appears here.

## The three URL kinds

Given a Worker named `<worker-name>` on an account whose workers.dev subdomain is `<subdomain>` and a production custom domain of `<production-hostname>`, the Deploy Adapter's `deploy status` surfaces three URLs:

| Kind | URL pattern | Changes on | Purpose |
|---|---|---|---|
| Per-version-id URL | `<version-prefix>-<worker-name>.<subdomain>.workers.dev` | Every upload assigns a new one; the URL for a given version is permanent | Pin a change-review link to a specific version id; never rots |
| Stable preview alias URL | `<alias>-<worker-name>.<subdomain>.workers.dev` | Never (points at a moving target: the newest-of-`<alias>`) | Persistent shareable review surface for stakeholders |
| Production URL, custom-domain branch | `<production-hostname>` (paired with `workers_dev = false`) | Only on an explicit `promote` workflow | User-facing traffic when a custom domain owns production |
| Production URL, workers.dev-only branch | `<worker-name>.<subdomain>.workers.dev` (paired with `workers_dev = true`) | Only on an explicit `promote` workflow | User-facing traffic when no custom domain is mapped |

The alias string is operator-chosen; `main` is the common default when the operator wants "the newest of the main branch" as the persistent preview. A project running multiple long-lived branches can allocate additional aliases (`staging`, `next`), each fixed to the newest-of-that-branch upload.

## Discovering the workers.dev subdomain

The `<subdomain>` segment in every workers.dev URL above is a per-account value the operator does not name in `wrangler.toml`. `wrangler whoami` prints the account id and email but does NOT print the subdomain; there is no wrangler 4.x CLI verb that returns it. The vendor's REST API returns it:

```
GET https://api.cloudflare.com/client/v4/accounts/<accountId>/workers/subdomain
Authorization: Bearer <cloudflareApiToken>
```

Response:

```json
{ "result": { "subdomain": "<subdomain>" }, "success": true, "errors": [], "messages": [] }
```

The Deploy Adapter's `resolveSubdomain()` verb (TAC-1301) wraps this call; every URL-assembly path calls the verb on boot and caches the value for the process's lifetime. A project that would rather pin the value in configuration sets an unambiguous `WORKERS_DEV_SUBDOMAIN` env var and the resolver returns that value ahead of the API call; the discovery path is the fallback so a fresh checkout works with no environment tuning.

## The upload verb

```
wrangler versions upload --preview-alias <alias>
```

Uploads the current build as a new version. Assigns a version id and returns two URLs on stdout: the per-version-id URL (unique per upload, permanent) and the stable preview alias URL (fixed to `<alias>`, always pointing at the version this upload just produced). The uploaded version does NOT serve production traffic; only the promote verb changes production.

`versions upload` refuses on a Worker that has not been deployed at least once (`You cannot upload a new version of a Worker that does not yet exist. Please run the 'deploy' command first.`). The first-time-per-Worker bootstrap uses `wrangler deploy --secrets-file <path>`; see `bootstrap-vs-steady-state.md`. Every subsequent ship rides `versions upload`.

## The promote verb

```
wrangler versions deploy <version-id>
```

Routes production traffic to the named version id. Requires the version id to be present in `wrangler versions list`. The blueprint's promote workflow calls this verb through the Deploy Adapter after resolving the version id from either the input `versionId` field or, when the input is empty, from the newest-of-alias resolution described below.

## Newest-of-alias resolution

The promote workflow's optional `versionId` input defaults to newest-of-`<alias>` when empty. There is no wrangler CLI verb that maps an alias string to a version id directly (`wrangler versions view` accepts a version UUID as a positional argument only; it does not accept an alias). The working resolution reads the versions list as JSON and filters by the alias annotation:

```
wrangler versions list --json
```

Each item carries `id`, `number`, `metadata.created_on`, and `annotations.workers/alias` (when the version was uploaded with `--preview-alias <alias>`). Newest-of-`<alias>` is the item whose `annotations.workers/alias` equals `<alias>` with the greatest `metadata.created_on`. A worked shape:

```javascript
// Inside the Deploy Adapter's default vendor binding.
const listOut = await runVendorCli(['versions', 'list', '--json']);
const versions = JSON.parse(listOut.stdout);
const forAlias = versions
  .filter(v => v.annotations?.['workers/alias'] === alias)
  .sort((a, b) => Date.parse(b.metadata.created_on) - Date.parse(a.metadata.created_on));
if (forAlias.length === 0) {
  throw new Error(`DEPLOY_ALIAS_UNKNOWN: no version behind alias '${alias}'`);
}
return forAlias[0].id;
```

A project that runs a single alias (the common `main`-only case) can drop the filter and pick the newest of any; the semantic is identical when only one alias exists.

## The rollback verb

Rollback IS a promote of a prior version id. The blueprint's Deploy Adapter surfaces one path (`promoteVersion`); the vendor's convenience shortcut `wrangler rollback [<version-id>]` is optional operator documentation for a break-glass path that bypasses the deploy-log record and the served-surface verifier. Do not use it as the recorded ship path.

## Reader notes

- The exact `<version-prefix>` string the vendor uses in the per-version-id URL is a vendor implementation detail; the operator does not name it. The URL is the whole shape; the adapter's `describeVersion` returns it verbatim.
- The alias URL host segment is a function of the alias string; the alias `main` produces the host segment `main-<worker-name>`. The Preview URL Resolver (TAC-1303) refuses an alias whose assembled host would equal the production URL host; a manifest that would collapse them refuses to load. Collapse is only reachable on the workers.dev-only production branch where alias `<worker-name>` (or any string that assembles to the same host) would collide with the production host; the branch's default alias `main` is safe by inspection.
- The production URL is derived from the wrangler manifest's `routes`/`route`/`workers_dev` block. When a custom domain owns production, the vendor's own custom-hostname primitive is what binds the domain to the Worker; the blueprint does not itself provision DNS or issue TLS. When `workers_dev = true` owns production, the URL is `<worker-name>.<subdomain>.workers.dev` and the resolver's `resolveSubdomain()` fills the `<subdomain>` segment.
