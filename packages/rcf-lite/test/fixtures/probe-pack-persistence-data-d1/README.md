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
  D1 scope is what the probe exercises. A 403/10000 on the first
  D1 call is recorded as an honest skip naming the missing scope,
  not a retry loop, per the master brief for e-mixed 2026-09-11.

The account-bound probe creates a scratch D1 database named
`qa-e-d1-<short>`, runs one migration and one query against it,
then deletes it and confirms the id is absent from the account's
D1 inventory (created-then-deleted-resource-id inventory-diff shape).

## Reviewer boot

Local (no account):

```
export PATH=$HOME/.n/n/versions/node/24.14.0/bin:$PATH
node ./blueprints/persistence-data-d1/contributions/probes/run-facade-round-trip.mjs
node ./blueprints/persistence-data-d1/contributions/probes/run-migrations-forward-only.mjs
node ./blueprints/persistence-data-d1/contributions/probes/run-real-account-d1-round-trip.mjs
```

The last records `accountBoundSkipped: true` without
`CI_HAS_CLOUDFLARE_ACCOUNT=true`.

Live (Stravica QA):

```
export CI_HAS_CLOUDFLARE_ACCOUNT=true
export CF_ACCOUNT_ID="$(pnpm exec secrets get hq-estate/CLOUDFLARE_WORKERS_ACCOUNT_ID_STRAVICA_QA)"
export CF_API_TOKEN="$(pnpm exec secrets get hq-estate/CLOUDFLARE_WORKERS_API_TOKEN_STRAVICA_QA)"
node ./blueprints/persistence-data-d1/contributions/probes/run-real-account-d1-round-trip.mjs
```
