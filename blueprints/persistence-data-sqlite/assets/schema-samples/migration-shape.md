# Migration entry shape

Every entry in the migration catalog (TAC-603) has this exact shape:

```
{
  version: <integer>,          // monotonic, starts at 1, no gaps
  description: <string>,        // human-readable; ships in the migration-failed error
  statements: [<string>, ...]   // one or more engine-native DDL/data statements
}
```

The `statements` list executes inside one transaction opened by the migration runner (TAC-602); the version bookkeeping row inserts inside the same transaction. On any failure, the transaction rolls back and the on-disk version reflects the last successfully committed migration.

## Worked example

A four-migration catalog starting with an eleven-table initial schema, followed by a soft-delete column, a boot marker, and a notifier-schema expansion. Statements are SQLite dialect at the default engine (ADR-601); the shape is identical under any alternate engine ADR-601 is superseded to.

```javascript
export const MIGRATIONS = [
  {
    version: 1,
    description: 'initial schema, eleven entities',
    statements: [
      `CREATE TABLE schemaVersion (
        version   INTEGER PRIMARY KEY,
        appliedAt TEXT    NOT NULL
      )`,
      `CREATE TABLE entityA (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`,
      // ... nine more CREATE TABLE statements per the initial schema
    ],
  },
  {
    version: 2,
    description: 'soft-delete: entityA.removedAt column for file-lane removal without eager history loss',
    statements: [
      `ALTER TABLE entityA ADD COLUMN removedAt TEXT`,
    ],
  },
  {
    version: 3,
    description: 'boot markers: audit trail of process starts for honest-gap accounting',
    statements: [
      `CREATE TABLE bootMarker (
        bootAt TEXT PRIMARY KEY
      )`,
    ],
  },
  {
    version: 4,
    description: 'notifier: per-entity channel routes and pending-delivery resume queue',
    statements: [
      `CREATE TABLE entityChannelRoute (
        entityId  TEXT NOT NULL,
        channelId TEXT NOT NULL,
        PRIMARY KEY (entityId, channelId)
      )`,
      `ALTER TABLE channel ADD COLUMN isDefault INTEGER NOT NULL DEFAULT 0`,
    ],
  },
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
```

## Rules a project must not break

- **Version integers are monotonic and start at 1 with no gaps.** A missing version between shipped entries breaks the ordering guarantee the runner relies on. Two contributors landing overlapping versions is a merge conflict, not a runtime bug.
- **A shipped migration is never edited.** Adding a statement to an already-shipped entry is a silent schema divergence between production stores at different open cycles. Fixes ship as new numbered migrations.
- **The statements list is engine-native.** Dialect matches the engine selected in ADR-601 (or its superseding project ADR). Statements are strings, not query builders; the runner does not interpret them.
- **The bookkeeping insert is the runner's responsibility, not the migration's.** A migration whose statements include an `INSERT INTO schemaVersion` corrupts the runner's ordering; the runner already handles that insert inside the same transaction.
