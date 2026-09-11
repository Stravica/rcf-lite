# probe-pack-persistence-data-sqlite fixture

Small self-contained fixture used by the `persistence-data-sqlite`
blueprint's contribution probes. The fixture provides a minimal store
facade over `node:sqlite` (Node 24 built-in) that realises the
blueprint's load-bearing shape: a single boot-time open entry point,
migrations run before it returns, typed verbs, WAL journal mode, and
metadata-only lifecycle events on an injected sink.

## Layout

- `src/store.mjs`: the store facade. Sole opener of the sqlite handle
  behind an `openStore({ path, eventSink })` factory. Emits
  `storeOpened`, `entryPut`, `entryRead`, `entryDeleted`,
  `walCheckpoint` and `storeClosed` records on the injected sink.

## Declared env vars

Every env var the fixture or its probes read is enumerated below.
Nothing else is consulted. A probe that short-circuits on an env var
not listed here is a probe that proved nothing.

- `RCF_FIXTURE_SQLITE_PATH` (optional): overrides the temporary
  sqlite file path the probes mint under the OS tmpdir. The probes
  create and destroy the file per run either way.

No account gate. The blueprint's engine is local; every probe runs
in-process against the real `node:sqlite` engine and asserts positive
evidence (a real integer row id, the applied-migration list, the WAL
checkpoint counters).

## Local run

Run from the repo root with Node 24 first on PATH:

```
# ensure Node 24 is first on PATH (project-specific incantation; see the repo docs)
node ./blueprints/persistence-data-sqlite/contributions/probes/run-boot-open-migrate.mjs
node ./blueprints/persistence-data-sqlite/contributions/probes/run-facade-round-trip.mjs
node ./blueprints/persistence-data-sqlite/contributions/probes/run-wal-checkpoint.mjs
```

Each writes its report envelope to
`.rcf/reports/blueprints/persistence-data-sqlite/<probe>.json`.
