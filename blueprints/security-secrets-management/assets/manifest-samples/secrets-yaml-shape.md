# `secrets.yaml` shape (sample)

The manifest lives at the repo root and is the single declaration of every secret the project depends on. Values never appear here; names, per-environment paths, and metadata do.

## Full shape

```yaml
version: 1
environments:
  - dev
  - ci
  - live
uiIntegration:
  mode: integrate    # one of: integrate, admin-spa, none
deployables:
  - id: api
    slice:
      - database-password
      - stripe-api-key
      - session-salt
  - id: worker
    slice:
      - database-password
      - queue-signing-key
secrets:
  - name: database-password
    owner: platform-team
    rotationDays: 90
    required: true
    paths:
      dev: secrets/dev/database-password.enc
      ci: secrets/ci/database-password.enc
      live: secrets/live/database-password.enc
  - name: stripe-api-key
    owner: payments-team
    rotationDays: 30
    required: true
    paths:
      dev: secrets/dev/stripe-api-key.enc
      ci: secrets/ci/stripe-api-key.enc
      live: secrets/live/stripe-api-key.enc
  - name: session-salt
    owner: platform-team
    rotationDays: 365
    required: true
    paths:
      dev: secrets/dev/session-salt.enc
      ci: secrets/ci/session-salt.enc
      live: secrets/live/session-salt.enc
  - name: queue-signing-key
    owner: platform-team
    rotationDays: 180
    required: false
    paths:
      dev: secrets/dev/queue-signing-key.enc
      ci: null
      live: secrets/live/queue-signing-key.enc
```

## Field notes

- `version`: an integer for future manifest evolution; loader refuses an unknown version.
- `environments`: a non-empty array of lower-kebab strings; the project's environment names, elicited from the operator at first apply and enforced from then on.
- `uiIntegration.mode`: one of `integrate`, `admin-spa`, `none`, recording the operator's three-way UI choice.
- `deployables[]`: each entry declares an `id` (matching the boot input the process passes to the client) and a `slice` (the ordered array of secret names that deployable is allowed to read).
- `secrets[]`: each entry carries `name`, `owner`, `rotationDays`, `required`, and a `paths` object whose key set equals `environments`. A path may be null on an optional entry to mark the secret as intentionally not present in that environment; a null on a required entry fails boot in that environment.

## What the loader refuses

- A missing `secrets.yaml` at the repo root.
- An entry whose `paths` key set differs from `environments`.
- An entry that carries a `value` field (secret values never live in the manifest).
- An entry whose `name` is not lower-kebab.
- A `uiIntegration.mode` value not in the enumerated set.
