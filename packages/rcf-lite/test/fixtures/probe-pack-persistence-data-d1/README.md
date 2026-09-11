# probe-pack-persistence-data-d1 fixture

Self-contained fixture used by the `persistence-data-d1` blueprint's
contribution probes. Provides an in-process mock of the Cloudflare
Workers D1 binding surface (`src/d1-binding-mock.mjs`) backed by
`node:sqlite`, plus the persistence facade (`src/facade.mjs`) the
probes drive. The facade is the sole reader of `env[DB]`; migrations
apply forward-only from `migrations/`.

## Declared env vars

Local branch:

- `RCF_FIXTURE_D1_SQLITE_PATH` (optional): overrides the temporary
  sqlite path backing the mock D1 binding.
- `SIMULATE_D1_RATE_LIMIT` (mutation switch, optional): when set to
  `true`, the mock throws a 429 on every `run()` call; the facade
  emits `queryFailed` with `errorKind: 'rateLimited'`. Used by
  induced-failure exercises off the main pack.

Live branch (real Cloudflare D1):

- `CI_HAS_CLOUDFLARE_ACCOUNT` (first-tier gate): when unset the
  real-account probe records `accountBoundSkipped: true` and the
  aggregate flips to pass per spec section 3.5.
- `CF_ACCOUNT_ID` (second-tier): Cloudflare account id.
- `CF_API_TOKEN` (second-tier): Cloudflare API token; the token's
  D1 scope is what the probe exercises. When the gate is set and
  credentials are set, a 401/403/auth-code response from the vendor
  is recorded as a FAIL (not a skip): the operator has asserted an
  account is present so an auth failure is a real failure, per the
  master brief for criterion e 2026-09-11 addendum.

The account-bound probe creates a scratch D1 database named
`qa-e-d1-<short>`, runs one migration and one query against it,
then deletes it and confirms the id is absent from the account's
D1 inventory (created-then-deleted-resource-id inventory-diff shape).

## Reviewer boot

Local (no account):

```
# ensure Node 24 is first on PATH (project-specific incantation; see the repo docs)
node ./blueprints/persistence-data-d1/contributions/probes/run-facade-round-trip.mjs
node ./blueprints/persistence-data-d1/contributions/probes/run-migrations-forward-only.mjs
node ./blueprints/persistence-data-d1/contributions/probes/run-real-account-d1-round-trip.mjs
```

The last records `accountBoundSkipped: true` without
`CI_HAS_CLOUDFLARE_ACCOUNT=true`.

Live (against a real Cloudflare account; supply your own vault reference):

```
export CI_HAS_CLOUDFLARE_ACCOUNT=true
export CF_ACCOUNT_ID="$(<your account-id lookup>)"
export CF_API_TOKEN="$(<your api-token lookup>)"
node ./blueprints/persistence-data-d1/contributions/probes/run-real-account-d1-round-trip.mjs
```
