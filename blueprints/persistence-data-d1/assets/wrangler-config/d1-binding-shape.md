# D1 binding shape in the wrangler config

The Worker reads the D1 database through a binding declared on `d1_databases[]` in the project's wrangler config file (`wrangler.jsonc` or `wrangler.toml`). This asset shows the exact shape with placeholders only; substitute the project's actual identifiers at the time of writing.

## Minimal shape (wrangler.jsonc)

```jsonc
{
  "name": "<worker-name>",
  "main": "src/worker.js",
  "compatibility_date": "<yyyy-mm-dd>",
  "d1_databases": [
    {
      "binding": "<BINDING_NAME>",
      "database_name": "<database-name>",
      "database_id": "<database-uuid>"
    }
  ]
}
```

Field notes:

- `binding` is the property name the Worker reads off `env`. Convention: uppercase snake or Pascal, one binding per named database per environment. The store facade module (TAC-1401) is the only place this name is read; every other module imports the facade.
- `database_name` is the human-readable name from `wrangler d1 create` or `wrangler d1 list`. Used by wrangler CLI arguments (`wrangler d1 execute <database_name> ...`); not read by the Worker.
- `database_id` is the vendor-assigned UUID from `wrangler d1 create` or `wrangler d1 info`. This is the durable identifier the vendor uses; substitute the value the project owns.

## Full shape with migration overrides (wrangler.jsonc)

```jsonc
{
  "d1_databases": [
    {
      "binding": "<BINDING_NAME>",
      "database_name": "<database-name>",
      "database_id": "<database-uuid>",
      "migrations_dir": "migrations",
      "migrations_table": "d1_migrations",
      "migrations_pattern": "*.sql"
    }
  ]
}
```

Field notes:

- `migrations_dir` names the directory the migration files live in. Default: `migrations/` at the wrangler config's parent directory. TAC-1402 anchors the migration catalog to this value.
- `migrations_table` names the D1-side bookkeeping table. Default: `d1_migrations`. TAC-1402 anchors the applied-state ledger to this value; AC-13102-3 reads this table for verification.
- `migrations_pattern` is a glob selecting migration files under `migrations_dir`. Default: the wrangler-generated numbered form. Override for ORM compatibility (Drizzle's `0000_name.sql`, Prisma's `<timestamp>_name/migration.sql`).

## Per-environment shape

Environments (dev, preview, live) each get their own D1 database. The `env` block on the wrangler config binds them per environment:

```jsonc
{
  "d1_databases": [
    {
      "binding": "<BINDING_NAME>",
      "database_name": "<database-name>-dev",
      "database_id": "<dev-database-uuid>"
    }
  ],
  "env": {
    "preview": {
      "d1_databases": [
        {
          "binding": "<BINDING_NAME>",
          "database_name": "<database-name>-preview",
          "database_id": "<preview-database-uuid>"
        }
      ]
    },
    "live": {
      "d1_databases": [
        {
          "binding": "<BINDING_NAME>",
          "database_name": "<database-name>-live",
          "database_id": "<live-database-uuid>"
        }
      ]
    }
  }
}
```

TAC-1403's deploy-gate orders `wrangler d1 migrations apply <database-name> --env <target>` strictly before `wrangler deploy --env <target>` for each named environment. The binding name stays constant across environments so the facade module reads the same `env[BINDING_NAME]` regardless of target.

## What this asset is not

Not a wrangler config template the project copies verbatim. The shape above is the SHAPE of the binding block; the project fills in its own identifiers, compatibility date, and any other fields (routes, custom domains, Static Assets) its Worker needs. A future `deploy-cloudflare-workers` blueprint (round-2 sibling) is the natural owner of the wider wrangler config surface; this blueprint owns the D1 binding shape only.

Not a credentials-storage guide. `CLOUDFLARE_API_TOKEN` and any deploy-specific secret the CI job uses are the concern of the `security-secrets-management` blueprint; store them there, not in this file.
