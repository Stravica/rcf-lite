# Migration catalog layout

The catalog exports `MIGRATIONS` (the ordered array) and `CURRENT_VERSION` (the max version integer). Two layouts satisfy TAC-603; pick one at project start and stay with it.

## Layout A: one file (recommended up to ~30 entries)

```
src/store/
  schema.js          // exports MIGRATIONS array and CURRENT_VERSION
  store.js           // the facade (TAC-601)
  migrationRunner.js // the runner (TAC-602)
```

`src/store/schema.js`:

```javascript
export const MIGRATIONS = [
  { version: 1, description: '...', statements: ['...'] },
  { version: 2, description: '...', statements: ['...'] },
  // ... more entries appended over the project's history
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
```

Pros: every version is visible on one screen; grep for a table name lands on the migration that created and every migration that altered it; PR review of a schema change is one file.

Cons: file size grows with history; large teams may see merge conflicts on the array-tail append.

## Layout B: one file per migration (recommended past ~30 entries)

```
src/store/
  schema.js          // aggregates the migrations directory into MIGRATIONS + CURRENT_VERSION
  migrations/
    001-initial-schema.js
    002-soft-delete-column.js
    003-boot-markers.js
    004-notifier-schema.js
    // ... one file per migration
  store.js
  migrationRunner.js
```

Each migration file:

```javascript
// src/store/migrations/002-soft-delete-column.js
export default {
  version: 2,
  description: 'soft-delete: entityA.removedAt column',
  statements: [`ALTER TABLE entityA ADD COLUMN removedAt TEXT`],
};
```

`src/store/schema.js` aggregates:

```javascript
import migration001 from './migrations/001-initial-schema.js';
import migration002 from './migrations/002-soft-delete-column.js';
// ... one import per migration file

export const MIGRATIONS = [migration001, migration002, /* ... */];
export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
```

Pros: one migration is one file; PR review is a fresh file, not an array edit; merge conflicts are structurally rare (contributors touch different filenames).

Cons: two-file edit per new migration; grep for a table name lands on multiple files; version integers appear in filenames and in the file body and must agree.

## Migration between layouts

Layout A converts to Layout B by extracting each array entry into a numbered file and rewriting `schema.js` to aggregate. The exported names (`MIGRATIONS`, `CURRENT_VERSION`) stay identical, so the runner and the facade do not change. Do the conversion in a single commit with no logical schema change.
